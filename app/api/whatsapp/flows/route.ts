/**
 * app/api/whatsapp/flows/route.ts
 *
 * Endpoint único para WhatsApp Flows (Meta).
 * Recebe payloads criptografados, processa e retorna respostas criptografadas.
 *
 * Flows suportados — discriminados pelo flow_token (formato: "threadId|companyId|flowType"):
 *   "threadId|companyId"          → Flow Checkout (legado / chatbot text)
 *   "threadId|companyId|checkout" → Flow Checkout (origem: catálogo)
 *   "threadId|companyId|catalog"  → Flow Catálogo
 *
 * Flow Checkout — CEP_SEARCH → ADDRESS → PAYMENT → SUCCESS
 * Flow Catálogo — CATEGORIES → PRODUCTS → CART_CONFIRM
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptFlowRequest, encryptFlowResponse } from "@/lib/whatsapp/flowCrypto";
import { sendWhatsAppMessage, sendListMessage, type WaConfig } from "@/lib/whatsapp/send";
import type { CartItem } from "@/lib/whatsapp/flows/flowCartTypes";
import {
    buildCatalogCategoriesFromProductRows,
    fetchFlowCatalogProducts,
    fetchFlowFavoriteItems,
    saveCatalogFlowScreen,
} from "@/lib/whatsapp/flows/catalogFlowHelpers";

export const runtime = "nodejs";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FlowRequestBody {
    version:    string;
    action:     "ping" | "INIT" | "data_exchange";
    flow_token: string;
    screen?:    string;
    data?:      Record<string, unknown>;
}

// ─── Helpers gerais ───────────────────────────────────────────────────────────

/**
 * Infere a tela do catálogo a partir das chaves do payload quando `screen` está vazio.
 * Meta pode enviar screen="" ou omitir o campo em data_exchange.
 */
function inferCatalogScreen(data: Record<string, unknown> | undefined): string {
    if (!data) return "";
    if ("payment_method" in data) return "PAYMENT";
    if ("rua" in data || "numero" in data) return "ADDRESS";
    if ("cep" in data || "selected_address_id" in data) return "CEP_SEARCH";
    if ("qty_1" in data) return "QUANTITIES";
    if ("selected_products" in data || "search_filter" in data || "category_id_cache" in data) return "PRODUCTS";
    if ("finalize_order" in data) return "CATEGORIES_RETURN";
    if ("category_id" in data || "search_all" in data) return "CATEGORIES"; // also matches CATEGORIES_RETURN (same fields)
    return "";
}

function formatCurrency(value: number): string {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCart(cart: CartItem[]): string {
    if (!cart.length) return "(carrinho vazio)";
    const lines = cart.map((i) => `${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`);
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    return `${lines.join("\n")}\n\n*Total: ${formatCurrency(total)}*`;
}

function mergeCartItems(existing: CartItem[], incoming: CartItem[]): CartItem[] {
    const merged = [...existing];
    for (const item of incoming) {
        const idx = merged.findIndex((i) => i.variantId === item.variantId);
        if (idx >= 0) {
            merged[idx] = { ...merged[idx], qty: merged[idx].qty + item.qty };
        } else {
            merged.push(item);
        }
    }
    return merged;
}

/**
 * Decodifica o flow_token.
 * Formato: "threadId|companyId" (legado) ou "threadId|companyId|flowType"
 */
function parseFlowToken(
    token: string
): { threadId: string; companyId: string; flowType: string } | null {
    const parts = token.split("|");
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return {
        threadId:  parts[0],
        companyId: parts[1],
        flowType:  parts[2] ?? "checkout",   // default: checkout (compatibilidade)
    };
}

const CATEGORY_EMOJIS: Record<string, string> = {
    cerveja: "🍺", refrigerante: "🥤", agua: "💧",
    suco: "🧃", energetico: "⚡", vinho: "🍷",
    destilado: "🥃", snack: "🍟", comida: "🍔",
};

function getCategoryEmoji(name: string): string {
    const key = name.toLowerCase().normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
    for (const [k, emoji] of Object.entries(CATEGORY_EMOJIS)) {
        if (key.includes(k)) return emoji;
    }
    return "📦";
}

function flowOrderStatusEmoji(status: string, conf: string): string {
    if (conf === "pending_confirmation") return "⏳";
    if (conf === "rejected") return "❌";
    if (status === "new") return "✅";
    if (status === "preparing") return "🔥";
    if (status === "delivering") return "🛵";
    if (status === "delivered") return "📦";
    if (status === "finalized") return "✅";
    if (status === "canceled") return "❌";
    return "📋";
}

function flowOrderStatusText(status: string, conf: string): string {
    if (conf === "pending_confirmation") return "Aguardando confirmação";
    if (conf === "rejected") return "Rejeitado";
    if (status === "new") return "Confirmado";
    if (status === "preparing") return "Em preparo";
    if (status === "delivering") return "Saiu para entrega";
    if (status === "delivered") return "Entregue";
    if (status === "finalized") return "Finalizado";
    if (status === "canceled") return "Cancelado";
    return "Em processamento";
}

function flowOrderPaymentLabel(m: string): string {
    return ({ pix: "PIX", card: "Cartão", cash: "Dinheiro" } as Record<string, string>)[m] ?? m;
}

function encryptedError(errorCode: string, aesKey: Buffer, iv: Buffer): NextResponse {
    console.error("[flows] error:", errorCode);
    const body = encryptFlowResponse(
        { version: "3.0", data: { error_message: errorCode } } as Record<string, unknown>,
        aesKey,
        iv
    );
    return new NextResponse(body, { headers: { "Content-Type": "text/plain" } });
}

function encryptedOk(payload: Record<string, unknown>, aesKey: Buffer, iv: Buffer): NextResponse {
    return new NextResponse(encryptFlowResponse(payload, aesKey, iv), {
        headers: { "Content-Type": "text/plain" },
    });
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    let rawBody: { encrypted_flow_data: string; encrypted_aes_key: string; initial_vector: string };
    try {
        rawBody = await req.json();
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { encrypted_flow_data, encrypted_aes_key, initial_vector } = rawBody;
    if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
        return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const admin = createAdminClient();

    const globalKey = process.env.WHATSAPP_FLOWS_PRIVATE_KEY;
    if (!globalKey) {
        console.error("[flows] WHATSAPP_FLOWS_PRIVATE_KEY não definida");
        return NextResponse.json({ error: "misconfigured" }, { status: 500 });
    }

    let flowBody: FlowRequestBody;
    let aesKey: Buffer;
    let iv: Buffer;

    try {
        const result = decryptFlowRequest(
            encrypted_flow_data, encrypted_aes_key, initial_vector, globalKey
        );
        flowBody = result.body as unknown as FlowRequestBody;
        aesKey   = result.aesKey;
        iv       = result.iv;
    } catch {
        console.error("[flows] Falha na decriptação com chave global");
        return NextResponse.json({ error: "decryption_failed" }, { status: 421 });
    }

    const { action, flow_token, screen, data: formData } = flowBody;

    // ── Health check ──────────────────────────────────────────────────────────
    if (action === "ping") {
        return encryptedOk({ version: "3.0", data: { status: "active" } }, aesKey, iv);
    }

    const ids = parseFlowToken(flow_token);
    if (!ids) return encryptedError("invalid_token", aesKey, iv);

    const { threadId, companyId, flowType } = ids;

    // ── Credenciais do canal + thread (parallel) ─────────────────────────────
    const needsThread = true; // todos os flows usam o telefone em algum momento
    const [channelRes, threadEarlyRes] = await Promise.all([
        admin
            .from("whatsapp_channels")
            .select("from_identifier, provider_metadata")
            .eq("company_id", companyId)
            .eq("provider", "meta")
            .eq("status", "active")
            .maybeSingle(),
        needsThread
            ? admin
                .from("whatsapp_threads")
                .select("phone_e164, profile_name")
                .eq("id", threadId)
                .maybeSingle()
            : Promise.resolve({ data: null }),
    ]);

    const channelRow  = channelRes.data;
    const channelMeta = channelRow?.provider_metadata as { access_token?: string } | null;
    const waConfig: WaConfig = {
        phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        accessToken:   channelMeta?.access_token   ?? process.env.WHATSAPP_TOKEN            ?? "",
    };
    // Dados da thread pré-carregados em paralelo com channels
    const earlyThreadData = (threadEarlyRes as { data: { phone_e164?: string; profile_name?: string } | null }).data;
    const earlyThreadPhone: string | null = earlyThreadData?.phone_e164 ?? null;
    const earlyThreadProfileName: string | null = earlyThreadData?.profile_name ?? null;

    // ═══════════════════════════════════════════════════════════════════════════
    // FLOW STATUS  (flowType === "status")
    // ═══════════════════════════════════════════════════════════════════════════
    if (flowType === "status") {
        if (action !== "INIT") return encryptedError("unsupported_action", aesKey, iv);

        // Usa telefone pré-carregado em paralelo com channels
        const threadPhone = earlyThreadPhone;

        if (!threadPhone) return encryptedError("thread_not_found", aesKey, iv);

        const phoneNorm = threadPhone.startsWith("+")
            ? threadPhone
            : `+${threadPhone}`;

        // Busca últimos 5 pedidos do cliente via customers.phone
        const { data: orders } = await admin
            .from("orders")
            .select(`
                id,
                created_at,
                status,
                confirmation_status,
                total_amount,
                delivery_address,
                payment_method,
                customers!inner ( phone ),
                order_items ( product_name, quantity )
            `)
            .eq("company_id", companyId)
            .eq("customers.phone", phoneNorm)
            .order("created_at", { ascending: false })
            .limit(5);

        if (!orders || orders.length === 0) {
            return encryptedOk(
                {
                    version: "3.0",
                    screen:  "NO_ORDERS",
                    data:    {} as Record<string, unknown>,
                },
                aesKey, iv
            );
        }

        const ordersText = (orders as any[]).map((o) => {
            const code  = `#${o.id.slice(0, 8).toUpperCase()}`;
            const emoji = flowOrderStatusEmoji(o.status, o.confirmation_status ?? "");
            const label = flowOrderStatusText(o.status, o.confirmation_status ?? "");
            const total = formatCurrency(Number.parseFloat(o.total_amount ?? 0));
            const date  = new Date(o.created_at).toLocaleString("pt-BR", {
                day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            });
            const items = (o.order_items ?? [])
                .slice(0, 3)
                .map((i: any) => `${i.quantity}x ${i.product_name}`)
                .join(", ");
            const moreItems = (o.order_items ?? []).length > 3
                ? ` +${(o.order_items ?? []).length - 3} item(s)` : "";

            return `${emoji} *Pedido ${code}*\n${label} • ${total}\n🍺 ${items}${moreItems}\n🕐 ${date}`;
        }).join("\n\n─────────────\n\n");

        const countText = `${orders.length} pedido${orders.length !== 1 ? "s" : ""} recente${orders.length !== 1 ? "s" : ""}`;

        return encryptedOk(
            {
                version: "3.0",
                screen:  "ORDER_LIST",
                data:    {
                    orders_text: ordersText,
                    total_count: countText,
                } as Record<string, unknown>,
            },
            aesKey, iv
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FLOW CATÁLOGO  (flowType === "catalog")
    // Fluxo único: CATEGORIES → PRODUCTS → QUANTITIES → CEP_SEARCH → ADDRESS → PAYMENT → SUCCESS
    // ═══════════════════════════════════════════════════════════════════════════
    if (flowType === "catalog") {

        // ── Telefone do cliente (pré-carregado acima em paralelo) ─────────────
        const customerPhone: string | null = earlyThreadPhone
            ? (earlyThreadPhone.startsWith("+") ? earlyThreadPhone : `+${earlyThreadPhone}`)
            : null;

        // ── INIT → tela CATEGORIES ────────────────────────────────────────────
        if (action === "INIT") {
            const { data: rows, error } = await admin
                .from("products")
                .select("category_id, categories!inner(id, name)")
                .eq("company_id", companyId)
                .eq("is_active", true)
                .not("category_id", "is", null);

            if (error) return encryptedError("db_error", aesKey, iv);

            const categories = buildCatalogCategoriesFromProductRows(rows ?? []);

            await saveCatalogFlowScreen(admin, threadId, "CATEGORIES", { catalog_screen: "CATEGORIES" });
            return encryptedOk(
                { version: "3.0", screen: "CATEGORIES", data: { categories } } as Record<string, unknown>,
                aesKey, iv
            );
        }

        if (action === "data_exchange") {

            // Lê sessão completa uma única vez para: screen fallback + cart + context + customer_id
            const { data: sessionForScreen } = await admin
                .from("chatbot_sessions")
                .select("context, cart, customer_id")
                .eq("thread_id", threadId)
                .maybeSingle();
            const sessionCtx    = (sessionForScreen?.context ?? {}) as Record<string, unknown>;
            const sessionScreen = String(sessionCtx?.catalog_screen ?? "").trim().toUpperCase();

            // Se Meta enviou payload de erro do cliente (ex: falha de renderização da tela)
            if (formData && "error" in formData) {
                console.error("[flows/catalog] client error payload | screen:", sessionScreen, "| error:", formData.error, "| message:", formData.error_message);
                return encryptedError("client_render_error", aesKey, iv);
            }

            // Normaliza o screen (Meta pode enviar com espaços ou caixa diferente)
            const screenNorm = screen
                ? String(screen).trim().toUpperCase()
                : (inferCatalogScreen(formData) || sessionScreen);
            console.log("[flows/catalog] data_exchange | screen:", JSON.stringify(screen), "| screenNorm:", screenNorm, "| sessionScreen:", sessionScreen, "| dataKeys:", Object.keys(formData ?? {}));

            // Helper: re-renderiza a tela CATEGORIES (sem screen = bug Meta)
            // Usa sessionCtx já carregado — sem DB read extra
            async function reRenderCategories() {
                const { data: catRows } = await admin
                    .from("products")
                    .select("category_id, categories!inner(id, name)")
                    .eq("company_id", companyId)
                    .eq("is_active", true)
                    .not("category_id", "is", null);
                const categories = buildCatalogCategoriesFromProductRows(catRows ?? []);

                const accCart = (sessionCtx?.accumulated_cart as CartItem[] | undefined) ?? [];
                const updatedCtx = { ...sessionCtx, catalog_screen: "CATEGORIES" };
                await saveCatalogFlowScreen(admin, threadId, "CATEGORIES", updatedCtx);
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "CATEGORIES",
                        data:    {
                            categories,
                            cart_so_far:     accCart.length > 0 ? formatCart(accCart) : "",
                            has_cart_so_far: accCart.length > 0,
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── CATEGORIES / CATEGORIES_RETURN → PRODUCTS ─────────────────────
            if (screenNorm === "CATEGORIES" || screenNorm === "CATEGORIES_RETURN") {

                // ── "Finalizar pedido" de CATEGORIES_RETURN → CEP_SEARCH ──────
                const doFinalize = Array.isArray(formData?.finalize_order)
                    ? (formData!.finalize_order as string[]).includes("finalize")
                    : false;
                if (doFinalize) {
                    // Usa sessão já carregada no início do data_exchange
                    const accCart    = (sessionCtx?.accumulated_cart as CartItem[] | undefined) ?? [];
                    const cartToShow = accCart.length > 0 ? accCart : ((sessionForScreen?.cart ?? []) as CartItem[]);

                    // Garante que accumulated_cart vire session.cart
                    const finalizeCtxBase = accCart.length > 0
                        ? { ...sessionCtx, accumulated_cart: null, source: "flow_catalog" }
                        : sessionCtx;
                    if (accCart.length > 0) {
                        await admin.from("chatbot_sessions")
                            .update({ cart: cartToShow, context: finalizeCtxBase })
                            .eq("thread_id", threadId);
                    }

                    type FinAddrSlot = { id: string; title: string; description: string };
                    let finAddresses: FinAddrSlot[] = [];
                    const finCustomerId = sessionForScreen?.customer_id as string | undefined;
                    if (finCustomerId) {
                        const { data: addrs } = await admin
                            .from("enderecos_cliente")
                            .select("id, apelido, logradouro, numero, bairro")
                            .eq("customer_id", finCustomerId)
                            .eq("company_id", companyId)
                            .order("is_principal", { ascending: false })
                            .limit(5);
                        if (addrs?.length) {
                            finAddresses = (addrs as any[]).map((a) => ({
                                id:          a.id,
                                title:       a.apelido,
                                description: [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", "),
                            }));
                        }
                    }

                    await saveCatalogFlowScreen(admin, threadId, "CEP_SEARCH", { ...finalizeCtxBase, catalog_screen: "CEP_SEARCH" });
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "CEP_SEARCH",
                            data:    {
                                cart_summary:        formatCart(cartToShow),
                                has_saved_addresses: finAddresses.length > 0,
                                saved_addresses:     finAddresses,
                            },
                        } as Record<string, unknown>,
                        aesKey, iv
                    );
                }

                const searchAll  = String(formData?.search_all  ?? "").trim();
                const categoryId = String(formData?.category_id ?? "").trim();

                // Nenhuma opção selecionada: re-renderiza CATEGORIES
                if (!searchAll && !categoryId) {
                    return reRenderCategories();
                }

                const catIdCache = categoryId;

                // Lookup nome da categoria para label — paralelo com produtos + favoritos
                const [catRow, products, favs] = await Promise.all([
                    !searchAll && categoryId
                        ? admin.from("categories").select("name").eq("id", categoryId).maybeSingle().then(r => r.data)
                        : Promise.resolve(null),
                    fetchFlowCatalogProducts(admin, companyId,
                        searchAll
                            ? { search: searchAll }
                            : { categoryId }   // passa id direto — sem double lookup
                    ),
                    !searchAll ? fetchFlowFavoriteItems(admin, companyId, customerPhone) : Promise.resolve([]),
                ]);

                const catName = (catRow as any)?.name ?? "";

                // Mescla favoritos no topo (apenas quando não é busca por texto)
                let allProducts = products;
                if (!searchAll) {
                    const favIds  = new Set((favs as any[]).map((f: any) => String(f.id)));
                    const deduped = products.filter((p: any) => !favIds.has(String(p.id)));
                    allProducts   = [...(favs as any[]), ...deduped].slice(0, 20);
                }

                if (!allProducts.length) return reRenderCategories();

                const categoryLabel = searchAll
                    ? `Resultados para "${searchAll.toUpperCase()}"`
                    : catName.toUpperCase();

                await saveCatalogFlowScreen(admin, threadId, "PRODUCTS", { ...sessionCtx, catalog_screen: "PRODUCTS" });
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "PRODUCTS",
                        data: {
                            products:           allProducts,
                            category_name:      categoryLabel,
                            category_id_cache:  catIdCache,
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── PRODUCTS: busca dentro da categoria OU seleciona produtos ─────
            if (screenNorm === "PRODUCTS") {
                const selectedIds   = Array.isArray(formData?.selected_products)
                    ? (formData!.selected_products as string[])
                    : [];
                const searchFilter  = String(formData?.search_filter   ?? "").trim();
                const catIdCache    = String(formData?.category_id_cache ?? "").trim();

                // Lookup do nome da categoria para label (apenas quando há catIdCache)
                const catNameForProducts = catIdCache
                    ? await admin.from("categories").select("name").eq("id", catIdCache).maybeSingle()
                        .then(r => r.data?.name ?? "")
                    : "";

                // Se busca preenchida e nada selecionado → filtra e retorna PRODUCTS de novo
                if (searchFilter && !selectedIds.length) {
                    const products = await fetchFlowCatalogProducts(admin, companyId,
                        catIdCache
                            ? { categoryId: catIdCache, search: searchFilter }
                            : { search: searchFilter }
                    );

                    const saveCtx = { ...sessionCtx, catalog_screen: "PRODUCTS" };
                    // Sem resultados: re-renderiza com todos os produtos da categoria
                    if (!products.length) {
                        const fallback = await fetchFlowCatalogProducts(admin, companyId, catIdCache ? { categoryId: catIdCache } : {});
                        await saveCatalogFlowScreen(admin, threadId, "PRODUCTS", saveCtx);
                        return encryptedOk(
                            { version: "3.0", screen: "PRODUCTS", data: { products: fallback, category_name: catNameForProducts.toUpperCase() || "PRODUTOS", category_id_cache: catIdCache } } as Record<string, unknown>,
                            aesKey, iv
                        );
                    }

                    const label = catIdCache
                        ? `"${searchFilter.toUpperCase()}" em ${catNameForProducts.toUpperCase() || "categoria"}`
                        : `Resultados para "${searchFilter.toUpperCase()}"`;

                    await saveCatalogFlowScreen(admin, threadId, "PRODUCTS", saveCtx);
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "PRODUCTS",
                            data: {
                                products,
                                category_name:     label,
                                category_id_cache: catIdCache,
                            },
                        } as Record<string, unknown>,
                        aesKey, iv
                    );
                }

                // Nenhum produto selecionado: re-renderiza PRODUCTS (sem screen = bug Meta)
                if (!selectedIds.length) {
                    const reProducts = await fetchFlowCatalogProducts(admin, companyId, catIdCache ? { categoryId: catIdCache } : {});
                    await saveCatalogFlowScreen(admin, threadId, "PRODUCTS", { ...sessionCtx, catalog_screen: "PRODUCTS" });
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "PRODUCTS",
                            data: {
                                products:          reProducts,
                                category_name:     catNameForProducts.toUpperCase() || "PRODUTOS",
                                category_id_cache: catIdCache,
                            },
                        } as Record<string, unknown>,
                        aesKey, iv
                    );
                }

                // Valida produtos selecionados (inclui sigla para agrupar na tela de qtd)
                const { data: validProducts, error: prodErr } = await admin
                    .from("produto_embalagens")
                    .select(`
                        id,
                        preco_venda,
                        descricao,
                        fator_conversao,
                        id_sigla_comercial,
                        siglas_comerciais ( sigla ),
                        products!inner ( name, is_active ),
                        product_volumes ( volume_quantidade, unit_types ( sigla ) )
                    `)
                    .in("id", selectedIds)
                    .eq("company_id", companyId)
                    .eq("products.is_active", true);

                if (prodErr || !validProducts?.length) {
                    console.error("[flows/catalog] invalid_products | prodErr:", prodErr?.message, "| catIdCache:", catIdCache);
                    const fbProducts = await fetchFlowCatalogProducts(admin, companyId, catIdCache ? { categoryId: catIdCache } : {});
                    await saveCatalogFlowScreen(admin, threadId, "PRODUCTS", { ...sessionCtx, catalog_screen: "PRODUCTS" });
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "PRODUCTS",
                            data: {
                                products:          fbProducts,
                                category_name:     catNameForProducts.toUpperCase() || "PRODUTOS",
                                category_id_cache: catIdCache,
                            },
                        } as Record<string, unknown>,
                        aesKey, iv
                    );
                }

                const isUN = (p: any) => {
                    const s = String(p.siglas_comerciais?.sigla ?? "").toUpperCase();
                    return s === "UN" || s === "";
                };

                // Ordena: não-UN primeiro (caixa, fardo, pacote…), depois unitários
                const sorted = [...validProducts].sort((a, b) => {
                    if (isUN(a) === isUN(b)) return 0;
                    return isUN(a) ? 1 : -1;
                }).slice(0, 5) as any[];

                const formatSlotName = (p: any): string => {
                    const sigla    = String(p.siglas_comerciais?.sigla ?? "").toUpperCase();
                    const name     = String(p.products.name ?? "").toUpperCase();
                    const price    = formatCurrency(Number.parseFloat(p.preco_venda) || 0);
                    const fator    = Number(p.fator_conversao ?? 0);
                    const descr    = String(p.descricao ?? "").trim();
                    const vol      = Number(p.product_volumes?.volume_quantidade ?? 0);
                    const unitSig  = String(p.product_volumes?.unit_types?.sigla ?? "").trim();
                    const volPart  = vol > 0 && unitSig ? `${vol}${unitSig}` : "";
                    const detail   = [descr, volPart].filter(Boolean).join(" ");

                    let embStr = "";
                    if (sigla && sigla !== "UN") {
                        const fatorPart = fator > 1 ? ` C/${fator}UN` : "";
                        embStr = `${detail} ${sigla}${fatorPart}`.trim();
                    } else {
                        embStr = detail;
                    }

                    return `${name} — ${embStr ? `${embStr} — ` : ""}${price}`;
                };

                // Usa sessionCtx já carregado (sem re-read)
                const existingCtx      = sessionCtx;
                const accumulatedForQty = (existingCtx.accumulated_cart as CartItem[] | undefined) ?? [];

                // Contexto completo com pending_ids + catalog_screen numa única escrita
                const quantitiesCtx = {
                    ...existingCtx,
                    source:              "flow_catalog",
                    pending_product_ids: sorted.map((p) => p.id),
                    pending_prices:      sorted.map((p) => Number.parseFloat(p.preco_venda) || 0),
                    pending_names:       sorted.map((p) => String(p.products.name ?? "").toUpperCase()),
                    catalog_screen:      "QUANTITIES",
                };

                // Busca endereços salvos em paralelo com a escrita da sessão
                const sessionCustomerId = sessionForScreen?.customer_id as string | undefined;
                type SavedAddr = { id: string; title: string; description: string };
                const [, addrsRes] = await Promise.all([
                    admin
                        .from("chatbot_sessions")
                        .update({ step: "awaiting_flow", context: quantitiesCtx })
                        .eq("thread_id", threadId),
                    sessionCustomerId
                        ? admin
                            .from("enderecos_cliente")
                            .select("id, apelido, logradouro, numero, bairro")
                            .eq("customer_id", sessionCustomerId)
                            .eq("company_id", companyId)
                            .order("is_principal", { ascending: false })
                            .limit(5)
                        : Promise.resolve({ data: null }),
                ]);

                const savedAddresses: SavedAddr[] = ((addrsRes as any).data ?? []).map((a: any) => ({
                    id:          a.id,
                    title:       a.apelido,
                    description: [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", "),
                }));
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "QUANTITIES",
                        data: {
                            product_name_1:      formatSlotName(sorted[0]),
                            product_name_2:      sorted[1] ? formatSlotName(sorted[1]) : "",
                            product_name_3:      sorted[2] ? formatSlotName(sorted[2]) : "",
                            product_name_4:      sorted[3] ? formatSlotName(sorted[3]) : "",
                            product_name_5:      sorted[4] ? formatSlotName(sorted[4]) : "",
                            show_qty_2:          sorted.length >= 2,
                            show_qty_3:          sorted.length >= 3,
                            show_qty_4:          sorted.length >= 4,
                            show_qty_5:          sorted.length >= 5,
                            cart_so_far:         accumulatedForQty.length > 0 ? formatCart(accumulatedForQty) : "",
                            has_cart_so_far:     accumulatedForQty.length > 0,
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── QUANTITIES → aplica quantidades → salva carrinho → CEP_SEARCH ─
            if (screenNorm === "QUANTITIES") {
                // Usa sessionCtx já carregado no início do data_exchange — sem re-read
                const context        = sessionCtx;
                const pendingIds     = (context.pending_product_ids as string[]) ?? [];
                const pendingPrices  = (context.pending_prices      as number[]) ?? [];
                const pendingNames   = (context.pending_names       as string[]) ?? [];
                const accumulatedCart = (context.accumulated_cart   as CartItem[] | undefined) ?? [];

                if (!pendingIds.length) {
                    console.error("[flows/catalog] QUANTITIES session_expired | pendingIds vazio | threadId:", threadId);
                    return await reRenderCategories();
                }

                console.log("[flows/catalog] QUANTITIES formData:", JSON.stringify(formData));

                const qtyFields = ["qty_1", "qty_2", "qty_3", "qty_4", "qty_5"];
                const cartItems: CartItem[] = pendingIds.map((id, i) => {
                    const raw = formData?.[qtyFields[i]];
                    const qty = Math.max(1, Math.round(
                        typeof raw === "number"
                            ? raw
                            : Number.parseFloat(String(raw ?? "1").replaceAll(",", ".").trim()) || 1
                    ));
                    return {
                        variantId: id,
                        name:      pendingNames[i] ?? id,
                        qty,
                        price:     pendingPrices[i] ?? 0,
                    };
                });

                console.log("[flows/catalog] QUANTITIES cartItems:", JSON.stringify(cartItems));

                // ── "Adicionar mais produtos" (CheckboxGroup) ─────────────────
                const addMore = Array.isArray(formData?.add_more_products)
                    ? (formData!.add_more_products as string[]).includes("add_more")
                    : false;

                if (addMore) {
                    const validItems     = cartItems.filter((i) => i.qty > 0);
                    const newAccumulated = mergeCartItems(accumulatedCart, validItems);

                    const { data: catRowsBack } = await admin
                        .from("products")
                        .select("category_id, categories!inner(id, name)")
                        .eq("company_id", companyId)
                        .eq("is_active", true)
                        .not("category_id", "is", null);

                    const categoriesBack = buildCatalogCategoriesFromProductRows(catRowsBack ?? []);

                    const addMoreCtx = {
                        ...context,
                        accumulated_cart:    newAccumulated,
                        pending_product_ids: undefined,
                        pending_prices:      undefined,
                        pending_names:       undefined,
                        catalog_screen:      "CATEGORIES_RETURN",
                    };
                    await saveCatalogFlowScreen(admin, threadId, "CATEGORIES_RETURN", addMoreCtx);
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "CATEGORIES_RETURN",
                            data:    {
                                categories:      categoriesBack,
                                cart_so_far:     formatCart(newAccumulated),
                                has_cart_so_far: true,
                            },
                        } as Record<string, unknown>,
                        aesKey, iv
                    );
                }

                // ── Fluxo normal: merge accumulated + current → finalCart ──────
                const finalCart = mergeCartItems(accumulatedCart, cartItems.filter((i) => i.qty > 0));

                const { error: cartSaveErr } = await admin
                    .from("chatbot_sessions")
                    .update({
                        cart:    finalCart,
                        context: {
                            ...context,
                            source:              "flow_catalog",
                            accumulated_cart:    null,
                            pending_product_ids: undefined,
                            pending_prices:      undefined,
                            pending_names:       undefined,
                        },
                    })
                    .eq("thread_id", threadId);

                if (cartSaveErr) {
                    console.error("[flows/catalog] QUANTITIES cart save error:", cartSaveErr.message);
                }

                // Busca endereços salvos — usa customer_id já carregado na sessão
                const qtyCustomerId = sessionForScreen?.customer_id as string | undefined;
                type SavedAddrSlot = { id: string; title: string; description: string };
                let qtySavedAddresses: SavedAddrSlot[] = [];
                if (qtyCustomerId) {
                    const { data: addrs } = await admin
                        .from("enderecos_cliente")
                        .select("id, apelido, logradouro, numero, bairro")
                        .eq("customer_id", qtyCustomerId)
                        .eq("company_id", companyId)
                        .order("is_principal", { ascending: false })
                        .limit(5);
                    if (addrs?.length) {
                        qtySavedAddresses = (addrs as any[]).map((a) => ({
                            id:          a.id,
                            title:       a.apelido,
                            description: [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", "),
                        }));
                    }
                }

                const cepSearchCtx = {
                    ...context,
                    source: "flow_catalog",
                    accumulated_cart: null,
                    pending_product_ids: undefined,
                    pending_prices: undefined,
                    pending_names: undefined,
                    catalog_screen: "CEP_SEARCH",
                };
                await saveCatalogFlowScreen(admin, threadId, "CEP_SEARCH", cepSearchCtx);
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "CEP_SEARCH",
                        data:    {
                            cart_summary:        formatCart(finalCart),
                            has_saved_addresses: qtySavedAddresses.length > 0,
                            saved_addresses:     qtySavedAddresses,
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── CEP_SEARCH → endereço salvo → PAYMENT | CEP → ADDRESS ─────────
            if (screenNorm === "CEP_SEARCH") {
                const selectedAddressId = String(formData?.selected_address_id ?? "").trim();
                const rawCep            = String(formData?.cep ?? "").replaceAll(/\D/g, "");

                // Helper local: lookup de zona de entrega
                const lookupZone = async (bairro: string) => {
                    const { data: zones } = await admin
                        .from("delivery_zones")
                        .select("id, label, fee, neighborhoods")
                        .eq("company_id", companyId)
                        .eq("is_active", true);
                    const nb = bairro.toLowerCase();
                    return (zones ?? []).find((z) => {
                        if (z.label.toLowerCase().includes(nb) || nb.includes(z.label.toLowerCase())) return true;
                        if (Array.isArray(z.neighborhoods))
                            return z.neighborhoods.some((n: string) =>
                                n.toLowerCase().includes(nb) || nb.includes(n.toLowerCase())
                            );
                        return false;
                    }) ?? null;
                };

                // Caminho A: cliente selecionou endereço salvo → vai direto ao PAYMENT
                if (selectedAddressId) {
                    const { data: savedAddr } = await admin
                        .from("enderecos_cliente")
                        .select("id, apelido, logradouro, numero, complemento, bairro")
                        .eq("id", selectedAddressId)
                        .eq("company_id", companyId)
                        .maybeSingle();

                    if (savedAddr) {
                        const bairro   = (savedAddr as any).bairro ?? "";
                        const zoneRow  = await lookupZone(bairro);
                        const delivFee = zoneRow ? Number(zoneRow.fee) : 0;
                        const address  = [(savedAddr as any).logradouro, (savedAddr as any).numero,
                                          (savedAddr as any).complemento, bairro]
                                          .filter(Boolean).join(", ");

                        // Usa cart + context já carregados na sessão inicial
                        const cart    = ((sessionForScreen?.cart ?? []) as CartItem[]);
                        const ctx     = sessionCtx;
                        const total   = cart.reduce((s, i) => s + i.price * i.qty, 0) + delivFee;
                        const feeText = delivFee > 0
                            ? `\n🛵 Taxa ${zoneRow?.label ?? bairro}: ${formatCurrency(delivFee)}`
                            : "";
                        const cartSummary = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(total)}*`;

                        const paymentCtx = {
                            ...ctx,
                            delivery_address:             address,
                            delivery_fee:                 delivFee,
                            delivery_zone_id:             zoneRow?.id ?? null,
                            flow_address_done:            true,
                            flow_apelido:                 (savedAddr as any).apelido,
                            flow_rua:                     (savedAddr as any).logradouro,
                            flow_numero:                  (savedAddr as any).numero,
                            flow_complemento:             (savedAddr as any).complemento,
                            flow_bairro_label:            bairro,
                            delivery_endereco_cliente_id: selectedAddressId,
                            catalog_screen:               "PAYMENT",
                        };
                        await admin.from("chatbot_sessions").update({ context: paymentCtx }).eq("thread_id", threadId);
                        return encryptedOk(
                            {
                                version: "3.0",
                                screen:  "PAYMENT",
                                data:    {
                                    address_display: `📍 ${address}`,
                                    cart_summary:    cartSummary,
                                },
                            } as Record<string, unknown>,
                            aesKey, iv
                        );
                    }
                }

                // Caminho B: cliente digitou CEP → ADDRESS com preenchimento automático
                let ruaInit    = "";
                let bairroInit = "";

                if (rawCep.length === 8) {
                    try {
                        const viaCepRes  = await fetch(
                            `https://viacep.com.br/ws/${rawCep}/json/`,
                            { signal: AbortSignal.timeout(3000) }
                        );
                        const viaCepData = await viaCepRes.json().catch(() => ({})) as Record<string, string>;
                        if (!viaCepData.erro) {
                            ruaInit    = viaCepData.logradouro ?? "";
                            bairroInit = viaCepData.bairro     ?? "";
                        }
                    } catch {
                        console.warn("[flows/catalog] ViaCEP falhou para CEP:", rawCep);
                    }
                }

                // Usa cart já carregado na sessão inicial
                const cart = ((sessionForScreen?.cart ?? []) as CartItem[]);
                await saveCatalogFlowScreen(admin, threadId, "ADDRESS", { ...sessionCtx, catalog_screen: "ADDRESS" });
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "ADDRESS",
                        data:    {
                            rua_init:     ruaInit,
                            bairro_init:  bairroInit,
                            cart_summary: formatCart(cart),
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── ADDRESS → valida campos → salva endereço → PAYMENT ───────────
            if (screenNorm === "ADDRESS") {
                const rua         = String(formData?.rua         ?? "").trim();
                const numero      = String(formData?.numero      ?? "").trim();
                const complemento = String(formData?.complemento ?? "").trim();
                const bairroText  = String(formData?.bairro      ?? "").trim();
                const apelido     = String(formData?.apelido     ?? "").trim();

                if (!rua || !numero || !bairroText || !apelido) {
                    return encryptedError("missing_address_fields", aesKey, iv);
                }

                // Lookup delivery zone
                const { data: allZones } = await admin
                    .from("delivery_zones")
                    .select("id, label, fee, neighborhoods")
                    .eq("company_id", companyId)
                    .eq("is_active", true);

                const normalizedBairro = bairroText.toLowerCase();
                const zoneRow = (allZones ?? []).find((z) => {
                    if (
                        z.label.toLowerCase().includes(normalizedBairro) ||
                        normalizedBairro.includes(z.label.toLowerCase())
                    ) return true;
                    if (Array.isArray(z.neighborhoods)) {
                        return z.neighborhoods.some((n: string) =>
                            n.toLowerCase().includes(normalizedBairro) ||
                            normalizedBairro.includes(n.toLowerCase())
                        );
                    }
                    return false;
                }) ?? null;

                const bairroLabel = zoneRow?.label ?? bairroText;
                const deliveryFee = zoneRow ? Number(zoneRow.fee) : 0;
                const address     = [rua, numero, complemento, bairroLabel].filter(Boolean).join(", ");

                // Usa cart + context já carregados na sessão inicial
                const cart    = ((sessionForScreen?.cart ?? []) as CartItem[]);
                const context = sessionCtx;

                const addrPaymentCtx = {
                    ...context,
                    delivery_address:  address,
                    delivery_fee:      deliveryFee,
                    delivery_zone_id:  zoneRow?.id ?? null,
                    flow_address_done: true,
                    flow_apelido:      apelido,
                    flow_rua:          rua,
                    flow_numero:       numero,
                    flow_complemento:  complemento,
                    flow_bairro_label: bairroLabel,
                    catalog_screen:    "PAYMENT",
                };
                await admin.from("chatbot_sessions").update({ context: addrPaymentCtx }).eq("thread_id", threadId);

                const totalItems  = cart.reduce((s, i) => s + i.price * i.qty, 0);
                const grandTotal  = totalItems + deliveryFee;
                const feeText     = deliveryFee > 0
                    ? `\n🛵 Taxa ${bairroLabel}: ${formatCurrency(deliveryFee)}`
                    : "";
                const cartSummary = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(grandTotal)}*`;
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "PAYMENT",
                        data:    {
                            address_display: `📍 ${address}`,
                            cart_summary:    cartSummary,
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── PAYMENT → cria pedido → SUCCESS ───────────────────────────────
            if (screenNorm === "PAYMENT") {
                const paymentMethod = String(formData?.payment_method ?? "").trim();
                const trocoStr      = String(formData?.troco_para     ?? "").trim();
                const changeFor     = trocoStr ? Number.parseFloat(trocoStr.replaceAll(",", ".")) || null : null;

                if (!paymentMethod) {
                    console.error("[flows/catalog] missing_payment_method | threadId:", threadId);
                    await saveCatalogFlowScreen(admin, threadId, "PAYMENT", { ...sessionCtx, catalog_screen: "PAYMENT" });
                    return encryptedOk({ version: "3.0", screen: "PAYMENT", data: {} } as Record<string, unknown>, aesKey, iv);
                }

                const { data: sessionRow } = await admin
                    .from("chatbot_sessions")
                    .select("id, cart, context, customer_id")
                    .eq("thread_id", threadId)
                    .maybeSingle();

                if (!sessionRow) return encryptedError("session_not_found", aesKey, iv);

                const cart    = (sessionRow.cart    ?? []) as CartItem[];
                const context = (sessionRow.context ?? {}) as Record<string, unknown>;
                const address = (context.delivery_address as string) ?? "";
                let customerId = sessionRow.customer_id as string | null ?? null;

                console.log("[flows/catalog] PAYMENT | cart:", JSON.stringify(cart), "| address:", address);

                if (!address) {
                    console.error("[flows/catalog] address_missing_in_session | threadId:", threadId);
                    return encryptedError("address_missing_in_session", aesKey, iv);
                }

                // Garante que o cliente existe (cria se necessário para salvar endereço e vínculo no pedido)
                if (!customerId) {
                    // Usa dados da thread pré-carregados em paralelo
                    const threadPhoneE164 = earlyThreadPhone;
                    const threadProfileName = earlyThreadProfileName;

                    if (threadPhoneE164) {
                        const phoneRaw = threadPhoneE164.replaceAll(/\D/g, "");
                        const { data: existCust } = await admin
                            .from("customers")
                            .select("id")
                            .eq("company_id", companyId)
                            .or(`phone_e164.eq.${threadPhoneE164},phone.eq.${phoneRaw}`)
                            .maybeSingle();

                        if (existCust?.id) {
                            customerId = existCust.id as string;
                        } else {
                            const { data: newCust } = await admin
                                .from("customers")
                                .insert({
                                    company_id: companyId,
                                    phone:      phoneRaw,
                                    phone_e164: threadPhoneE164,
                                    name:       threadProfileName ?? null,
                                    origem:     "flow_catalog",
                                })
                                .select("id")
                                .single();
                            if (newCust?.id) customerId = newCust.id as string;
                        }

                        if (customerId) {
                            await admin
                                .from("chatbot_sessions")
                                .update({ customer_id: customerId })
                                .eq("thread_id", threadId);
                        }
                    }
                }

                const deliveryFee = (context.delivery_fee as number) ?? 0;
                const totalItems  = cart.reduce((s, i) => s + i.price * i.qty, 0);
                const grandTotal  = totalItems + deliveryFee;

                // Upsert endereço do cliente
                let deliveryEnderecoClienteId: string | null =
                    (context.delivery_endereco_cliente_id as string | undefined) ?? null;

                if (customerId) {
                    const flowApelido     = (context.flow_apelido      as string) ?? "";
                    const flowRua         = (context.flow_rua          as string) ?? address;
                    const flowNumero      = (context.flow_numero        as string) ?? null;
                    const flowComplemento = (context.flow_complemento   as string) ?? null;
                    const flowBairro      = (context.flow_bairro_label  as string) ?? null;

                    const { data: existingAddr } = await admin
                        .from("enderecos_cliente")
                        .select("id")
                        .eq("customer_id", customerId)
                        .eq("company_id",  companyId)
                        .eq("apelido",     flowApelido)
                        .maybeSingle();

                    if (existingAddr?.id) {
                        await admin.from("enderecos_cliente").update({
                            logradouro:   flowRua,
                            numero:       flowNumero,
                            complemento:  flowComplemento,
                            bairro:       flowBairro,
                            is_principal: true,
                        }).eq("id", existingAddr.id);
                        deliveryEnderecoClienteId = existingAddr.id;
                    } else {
                        const { data: inserted } = await admin
                            .from("enderecos_cliente")
                            .insert({
                                company_id:   companyId,
                                customer_id:  customerId,
                                apelido:      flowApelido,
                                logradouro:   flowRua,
                                numero:       flowNumero,
                                complemento:  flowComplemento,
                                bairro:       flowBairro,
                                is_principal: true,
                            })
                            .select("id")
                            .single();
                        if (inserted?.id) deliveryEnderecoClienteId = inserted.id as string;
                    }
                }

                const { data: settings } = await admin
                    .from("company_settings")
                    .select("require_order_approval")
                    .eq("company_id", companyId)
                    .maybeSingle();

                const requireApproval    = settings?.require_order_approval ?? false;
                const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";

                if (!cart.length) {
                    console.error("[flows/catalog] PAYMENT cart vazio ao criar pedido | threadId:", threadId);
                    return encryptedError("empty_cart", aesKey, iv);
                }

                const { data: orderId, error: orderErr } = await admin.rpc("create_order_with_items", {
                    p_company_id:                   companyId,
                    p_customer_id:                  customerId,
                    p_status:                       "new",
                    p_confirmation_status:          confirmationStatus,
                    p_source:                       "flow_catalog",
                    p_channel:                      "whatsapp",
                    p_total_amount:                 grandTotal,
                    p_total:                        totalItems,   // subtotal sem frete
                    p_delivery_fee:                 deliveryFee,
                    p_delivery_address:             address,
                    p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
                    p_payment_method:               paymentMethod,
                    p_change_for:                   changeFor,
                    p_paid:                         false,
                    p_items: cart.map((item) => ({
                        product_name:         item.name,
                        produto_embalagem_id: item.variantId ?? null,
                        quantity:             item.qty,
                        unit_price:           item.price,
                    })),
                });

                if (orderErr || !orderId) {
                    console.error("[flows/catalog] Erro ao criar pedido:", orderErr?.message);
                    return encryptedError("order_creation_failed", aesKey, iv);
                }
                const order = { id: orderId as string };

                await admin
                    .from("chatbot_sessions")
                    .update({ cart: [], step: "main_menu", context: {} })
                    .eq("thread_id", threadId);

                // Usa telefone pré-carregado no início (sem DB extra)
                if (customerPhone) {
                    const pmLabel = flowOrderPaymentLabel(paymentMethod);
                    const feeText   = deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}` : "";
                    const chgText   = changeFor ? ` (troco para ${formatCurrency(changeFor)})` : "";
                    const orderCode = `#${order.id.replaceAll(/-/g, "").slice(-6).toUpperCase()}`;

                    const msg = requireApproval
                        ? `✅ *Pedido Recebido!*\n\nPedido ${orderCode}\nTotal: ${formatCurrency(grandTotal)}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
                        : `✅ *Pedido Confirmado!*\n\nPedido ${orderCode}\n\n${formatCart(cart)}${feeText}\n📍 ${address}\n💳 ${pmLabel}${chgText}\n\n🚚 Previsão: 30-40 min\n\nObrigado pela preferência! 🍺`;

                    await sendWhatsAppMessage(customerPhone, msg, waConfig);
                }

                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "SUCCESS",
                        data:    { order_code: `#${order.id.replaceAll(/-/g, "").slice(-6).toUpperCase()}` },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            console.error("[flows/catalog] screen não reconhecido | raw:", JSON.stringify(screen), "| norm:", screenNorm, "| action:", action);
            return encryptedError("unknown_catalog_screen", aesKey, iv);
        }

        return encryptedError("unknown_catalog_action", aesKey, iv);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // FLOW CHECKOUT  (flowType === "checkout" | legado 2 partes)
    // ═══════════════════════════════════════════════════════════════════════════

    // ── INIT — retorna tela CEP_SEARCH com resumo do carrinho ─────────────────
    if (action === "INIT") {
        const sessionResult = await admin
            .from("chatbot_sessions")
            .select("cart")
            .eq("thread_id", threadId)
            .maybeSingle();

        const cart = (sessionResult.data?.cart ?? []) as CartItem[];

        return encryptedOk(
            { version: "3.0", screen: "CEP_SEARCH", data: { cart_summary: formatCart(cart) } },
            aesKey, iv
        );
    }

    // ── data_exchange ─────────────────────────────────────────────────────────
    if (action === "data_exchange") {

        // ── CEP_SEARCH → busca ViaCEP → navega para ADDRESS ──────────────────
        if (screen === "CEP_SEARCH") {
            const rawCep = String(formData?.cep ?? "").replaceAll(/\D/g, "");

            let ruaInit    = "";
            let bairroInit = "";

            if (rawCep.length === 8) {
                try {
                    const viaCepRes  = await fetch(
                        `https://viacep.com.br/ws/${rawCep}/json/`,
                        { signal: AbortSignal.timeout(3000) }
                    );
                    const viaCepData = await viaCepRes.json().catch(() => ({})) as Record<string, string>;
                    if (!viaCepData.erro) {
                        ruaInit    = viaCepData.logradouro ?? "";
                        bairroInit = viaCepData.bairro     ?? "";
                    }
                } catch {
                    console.warn("[flows] ViaCEP falhou para CEP:", rawCep);
                }
            }

            const sessionResult = await admin
                .from("chatbot_sessions")
                .select("cart")
                .eq("thread_id", threadId)
                .maybeSingle();

            const cart = (sessionResult.data?.cart ?? []) as CartItem[];

            return encryptedOk(
                {
                    version: "3.0",
                    screen:  "ADDRESS",
                    data:    {
                        rua_init:     ruaInit,
                        bairro_init:  bairroInit,
                        cart_summary: formatCart(cart),
                    },
                },
                aesKey, iv
            );
        }

        // ── ADDRESS → valida e salva endereço → navega para PAYMENT ──────────
        if (screen === "ADDRESS") {
            const rua         = String(formData?.rua         ?? "").trim();
            const numero      = String(formData?.numero      ?? "").trim();
            const complemento = String(formData?.complemento ?? "").trim();
            const bairroText  = String(formData?.bairro      ?? "").trim();
            const apelido     = String(formData?.apelido     ?? "").trim();

            if (!rua || !numero || !bairroText || !apelido) {
                return encryptedError("missing_address_fields", aesKey, iv);
            }

            // Busca zona de entrega
            const { data: allZones } = await admin
                .from("delivery_zones")
                .select("id, label, fee, neighborhoods")
                .eq("company_id", companyId)
                .eq("is_active", true);

            const normalizedBairro = bairroText.toLowerCase();
            const zoneRow = (allZones ?? []).find((z) => {
                if (
                    z.label.toLowerCase().includes(normalizedBairro) ||
                    normalizedBairro.includes(z.label.toLowerCase())
                ) return true;
                if (Array.isArray(z.neighborhoods)) {
                    return z.neighborhoods.some((n: string) =>
                        n.toLowerCase().includes(normalizedBairro) ||
                        normalizedBairro.includes(n.toLowerCase())
                    );
                }
                return false;
            }) ?? null;

            const bairroLabel = zoneRow?.label ?? bairroText;
            const deliveryFee = zoneRow ? Number(zoneRow.fee) : 0;
            const address     = [rua, numero, complemento, bairroLabel].filter(Boolean).join(", ");

            // Carrega sessão e salva endereço no contexto
            const { data: sessionRow } = await admin
                .from("chatbot_sessions")
                .select("cart, context")
                .eq("thread_id", threadId)
                .maybeSingle();

            const cart    = (sessionRow?.cart    ?? []) as CartItem[];
            const context = (sessionRow?.context ?? {}) as Record<string, unknown>;

            await admin
                .from("chatbot_sessions")
                .update({
                    context: {
                        ...context,
                        delivery_address:  address,
                        delivery_fee:      deliveryFee,
                        delivery_zone_id:  zoneRow?.id ?? null,
                        flow_address_done: true,
                        flow_apelido:      apelido,
                        flow_rua:          rua,
                        flow_numero:       numero,
                        flow_complemento:  complemento,
                        flow_bairro_label: bairroLabel,
                    },
                })
                .eq("thread_id", threadId);

            const totalProducts = cart.reduce((s, i) => s + i.price * i.qty, 0);
            const grandTotal    = totalProducts + deliveryFee;
            const feeText       = deliveryFee > 0
                ? `\n🛵 Taxa ${bairroLabel}: ${formatCurrency(deliveryFee)}`
                : "";
            const cartSummary   = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(grandTotal)}*`;

            return encryptedOk(
                {
                    version: "3.0",
                    screen:  "PAYMENT",
                    data:    {
                        address_display: `📍 ${address}`,
                        cart_summary:    cartSummary,
                    },
                },
                aesKey, iv
            );
        }

        // ── PAYMENT → conclui, cria pedido (catálogo) ou envia lista (chatbot) ─
        if (screen === "PAYMENT") {
            const paymentMethod = String(formData?.payment_method ?? "").trim();
            const trocoStr      = String(formData?.troco_para     ?? "").trim();
            const changeFor     = trocoStr ? Number.parseFloat(trocoStr.replaceAll(",", ".")) || null : null;

            if (!paymentMethod) return encryptedError("missing_payment_method", aesKey, iv);

            // Carrega sessão (com endereço já salvo pelo handler ADDRESS)
            const { data: sessionRow } = await admin
                .from("chatbot_sessions")
                .select("id, cart, context, customer_id")
                .eq("thread_id", threadId)
                .maybeSingle();

            if (!sessionRow) return encryptedError("session_not_found", aesKey, iv);

            const cart    = (sessionRow.cart    ?? []) as CartItem[];
            const context = (sessionRow.context ?? {}) as Record<string, unknown>;
            const address = (context.delivery_address as string) ?? "";

            if (!address) return encryptedError("address_missing_in_session", aesKey, iv);

            const deliveryFee  = (context.delivery_fee as number) ?? 0;
            const totalItems   = cart.reduce((s, i) => s + i.price * i.qty, 0);
            const grandTotal   = totalItems + deliveryFee;
            const customerId   = sessionRow.customer_id ?? null;

            // Upsert endereço do cliente (quando tem customer_id)
            let deliveryEnderecoClienteId: string | null =
                (context.delivery_endereco_cliente_id as string | undefined) ?? null;

            if (customerId) {
                const flowApelido     = (context.flow_apelido     as string) ?? "";
                const flowRua         = (context.flow_rua         as string) ?? address;
                const flowNumero      = (context.flow_numero      as string) ?? null;
                const flowComplemento = (context.flow_complemento as string) ?? null;
                const flowBairro      = (context.flow_bairro_label as string) ?? null;

                const { data: existingAddr } = await admin
                    .from("enderecos_cliente")
                    .select("id")
                    .eq("customer_id",  customerId)
                    .eq("company_id",   companyId)
                    .eq("apelido",      flowApelido)
                    .maybeSingle();

                if (existingAddr?.id) {
                    await admin.from("enderecos_cliente").update({
                        logradouro:   flowRua,
                        numero:       flowNumero,
                        complemento:  flowComplemento,
                        bairro:       flowBairro,
                        is_principal: true,
                    }).eq("id", existingAddr.id);
                    deliveryEnderecoClienteId = existingAddr.id;
                } else {
                    const { data: inserted } = await admin
                        .from("enderecos_cliente")
                        .insert({
                            company_id:   companyId,
                            customer_id:  customerId,
                            apelido:      flowApelido,
                            logradouro:   flowRua,
                            numero:       flowNumero,
                            complemento:  flowComplemento,
                            bairro:       flowBairro,
                            is_principal: true,
                        })
                        .select("id")
                        .single();
                    if (inserted?.id) deliveryEnderecoClienteId = inserted.id as string;
                }
            }

            // Salva contexto final de pagamento
            await admin
                .from("chatbot_sessions")
                .update({
                    step:    "checkout_confirm",
                    context: {
                        ...context,
                        payment_method:               paymentMethod,
                        change_for:                   changeFor ?? null,
                        flow_address_done:            false,
                        delivery_endereco_cliente_id: deliveryEnderecoClienteId,
                    },
                })
                .eq("thread_id", threadId);

            // Usa telefone pré-carregado em paralelo com channels
            const phoneE164 = earlyThreadPhone;

            // ──────────────────────────────────────────────────────────────────
            // CAMINHO CATÁLOGO: cria pedido diretamente (o Flow já confirmou tudo)
            // ──────────────────────────────────────────────────────────────────
            const source = (context.source as string) ?? "chatbot";

            if (source === "flow_catalog") {
                // Busca toggles da empresa
                const { data: settings } = await admin
                    .from("company_settings")
                    .select("require_order_approval")
                    .eq("company_id", companyId)
                    .maybeSingle();

                const requireApproval = settings?.require_order_approval ?? false;
                const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";

                // Cria pedido + itens atomicamente via RPC (bloqueia pedido vazio no banco)
                const { data: orderId, error: orderErr } = await admin.rpc("create_order_with_items", {
                    p_company_id:                   companyId,
                    p_customer_id:                  customerId,
                    p_status:                       "new",
                    p_confirmation_status:          confirmationStatus,
                    p_source:                       "flow_catalog",
                    p_channel:                      "whatsapp",
                    p_total_amount:                 grandTotal,
                    p_total:                        totalItems,   // subtotal sem frete
                    p_delivery_fee:                 deliveryFee,
                    p_delivery_address:             address,
                    p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
                    p_payment_method:               paymentMethod,
                    p_change_for:                   changeFor,
                    p_paid:                         false,
                    p_items: cart.map((item) => ({
                        product_name:         item.name,
                        produto_embalagem_id: item.variantId ?? null,
                        quantity:             item.qty,
                        unit_price:           item.price,
                    })),
                });

                if (orderErr || !orderId) {
                    console.error("[flows] Erro ao criar pedido:", orderErr?.message);
                    return encryptedError("order_creation_failed", aesKey, iv);
                }
                const order = { id: orderId as string };

                // Limpa sessão
                await admin
                    .from("chatbot_sessions")
                    .update({ cart: [], step: "main_menu", context: {} })
                    .eq("thread_id", threadId);

                // Envia confirmação WhatsApp
                if (phoneE164) {
                    const pmLabel = flowOrderPaymentLabel(paymentMethod);
                    const feeText = deliveryFee > 0
                        ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}`
                        : "";
                    const changeText = changeFor
                        ? ` (troco para ${formatCurrency(changeFor)})`
                        : "";

                    const msg = requireApproval
                        ? `✅ *Pedido Recebido!*\n\nPedido #${order.id.replaceAll(/-/g, "").slice(-6).toUpperCase()}\nTotal: ${formatCurrency(grandTotal)}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
                        : `✅ *Pedido Confirmado!*\n\nPedido #${order.id.replaceAll(/-/g, "").slice(-6).toUpperCase()}\n\n${formatCart(cart)}${feeText}\n📍 ${address}\n💳 ${pmLabel}${changeText}\n\n🚚 Previsão: 30-40 min\n\nObrigado pela preferência! 🍺`;

                    await sendWhatsAppMessage(phoneE164, msg, waConfig);
                }

                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "SUCCESS",
                        data:    { order_code: `#${order.id.replaceAll(/-/g, "").slice(-6).toUpperCase()}` },
                    },
                    aesKey, iv
                );
            }

            // ──────────────────────────────────────────────────────────────────
            // CAMINHO CHATBOT: envia resumo + lista de confirmação (comportamento original)
            // ──────────────────────────────────────────────────────────────────
            if (phoneE164) {
                const paymentLabel = flowOrderPaymentLabel(paymentMethod);
                const feeText      = deliveryFee > 0
                    ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}`
                    : "";
                const changeText   = changeFor
                    ? ` (troco para ${formatCurrency(changeFor)})`
                    : "";

                const summaryText =
                    `📋 *Resumo do pedido:*\n\n` +
                    `${formatCart(cart)}\n` +
                    `${feeText}\n` +
                    `📍 Entrega: ${address}\n` +
                    `💳 Pagamento: ${paymentLabel}${changeText}\n\n` +
                    `💰 *Total: ${formatCurrency(grandTotal)}*`;

                await sendWhatsAppMessage(phoneE164, summaryText, waConfig);

                const hasLinkedAddr = !!deliveryEnderecoClienteId;
                const rows: Array<{ id: string; title: string; description?: string }> = [];
                if (!hasLinkedAddr) {
                    rows.push({
                        id:          "save_address",
                        title:       "💾 Salvar endereço",
                        description: "Cadastrar c/ apelido p/ próximos pedidos",
                    });
                }
                rows.push(
                    { id: "confirmar",      title: "✅ Confirmar pedido", description: "Fechar e enviar p/ a loja" },
                    { id: "change_items",   title: "🔄 Alterar itens" },
                    { id: "change_address", title: "📍 Mudar endereço" }
                );
                await sendListMessage(phoneE164, "Escolha uma opção:", "Ver opções", rows, "Pedido", waConfig);
            }

            return encryptedOk(
                {
                    version: "3.0",
                    screen:  "SUCCESS",
                    data:    { order_code: "📱 Confira na conversa!" },
                },
                aesKey, iv
            );
        }

        return encryptedError("unknown_screen", aesKey, iv);
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
