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

export const runtime = "nodejs";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FlowRequestBody {
    version:    string;
    action:     "ping" | "INIT" | "data_exchange";
    flow_token: string;
    screen?:    string;
    data?:      Record<string, unknown>;
}

type CartItem = {
    name:       string;
    qty:        number;
    price:      number;
    variantId?: string;
    productId?: string;
    isCase?:    boolean;
};

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
    if ("category_id" in data || "search_all" in data) return "CATEGORIES";
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
    const key = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const [k, emoji] of Object.entries(CATEGORY_EMOJIS)) {
        if (key.includes(k)) return emoji;
    }
    return "📦";
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

    // ── Credenciais do canal da empresa ───────────────────────────────────────
    const { data: channelRow } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata")
        .eq("company_id", companyId)
        .eq("provider", "meta")
        .eq("status", "active")
        .maybeSingle();

    const channelMeta = channelRow?.provider_metadata as { access_token?: string } | null;
    const waConfig: WaConfig = {
        phoneNumberId: channelRow?.from_identifier ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        accessToken:   channelMeta?.access_token   ?? process.env.WHATSAPP_TOKEN            ?? "",
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // FLOW STATUS  (flowType === "status")
    // ═══════════════════════════════════════════════════════════════════════════
    if (flowType === "status") {
        if (action !== "INIT") return encryptedError("unsupported_action", aesKey, iv);

        // Busca telefone da thread
        const { data: threadRow } = await admin
            .from("whatsapp_threads")
            .select("phone_e164")
            .eq("id", threadId)
            .maybeSingle();

        if (!threadRow?.phone_e164) return encryptedError("thread_not_found", aesKey, iv);

        const phoneNorm = threadRow.phone_e164.startsWith("+")
            ? threadRow.phone_e164
            : `+${threadRow.phone_e164}`;

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

        const statusEmoji = (status: string, conf: string): string => {
            if (conf === "pending_confirmation") return "⏳";
            if (conf === "rejected")             return "❌";
            if (status === "new")                return "✅";
            if (status === "preparing")          return "🔥";
            if (status === "delivering")         return "🛵";
            if (status === "delivered")          return "📦";
            if (status === "finalized")          return "✅";
            if (status === "canceled")           return "❌";
            return "📋";
        };

        const statusText = (status: string, conf: string): string => {
            if (conf === "pending_confirmation") return "Aguardando confirmação";
            if (conf === "rejected")             return "Rejeitado";
            if (status === "new")                return "Confirmado";
            if (status === "preparing")          return "Em preparo";
            if (status === "delivering")         return "Saiu para entrega";
            if (status === "delivered")          return "Entregue";
            if (status === "finalized")          return "Finalizado";
            if (status === "canceled")           return "Cancelado";
            return "Em processamento";
        };

        const pmLabel = (m: string): string =>
            ({ pix: "PIX", card: "Cartão", cash: "Dinheiro" })[m] ?? m;

        const ordersText = (orders as any[]).map((o) => {
            const code  = `#${o.id.slice(0, 8).toUpperCase()}`;
            const emoji = statusEmoji(o.status, o.confirmation_status ?? "");
            const label = statusText(o.status, o.confirmation_status ?? "");
            const total = formatCurrency(parseFloat(o.total_amount ?? 0));
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

        // ── Helper: busca produtos formatados para o Flow ─────────────────────
        async function fetchProducts(opts: {
            categoryName?: string | null;
            search?:       string | null;
        }): Promise<Array<Record<string, unknown>>> {
            const selectFields = "id, product_name, preco_venda, volume_quantidade, fator_conversao, id_unit_type, product_volume_id, unit_type_sigla, sigla_comercial, thumbnail_url, image_url";

            if (opts.search) {
                const { data } = await admin
                    .from("view_chat_produtos")
                    .select(selectFields)
                    .eq("company_id", companyId)
                    .ilike("product_name", `%${opts.search}%`)
                    .limit(20);

                return buildProductItems(data ?? []);
            }

            // Busca por categoria via view (ordenada por nome)
            let query = admin
                .from("view_chat_produtos")
                .select(selectFields)
                .eq("company_id", companyId)
                .order("product_name");

            if (opts.categoryName) {
                // Busca o category_id pelo nome
                const { data: cat } = await admin
                    .from("categories")
                    .select("id")
                    .eq("company_id", companyId)
                    .ilike("name", opts.categoryName)
                    .maybeSingle();
                if (cat?.id) query = query.eq("category_id", cat.id);
            }

            const { data } = await query.limit(20);
            return buildProductItems(data ?? []);
        }

        function buildProductItems(rows: any[]): Array<Record<string, unknown>> {
            return rows.map((p: any) => {
                const sigla = String(p.sigla_comercial ?? "").toUpperCase();
                const fator = p.fator_conversao;
                const vol   = p.volume_quantidade;
                const unit  = p.unit_type_sigla ?? "";

                // Embalagem: "CX - 12" para caixas/fardos, "600ml" para unidades com volume
                let packStr = "";
                if (sigla && sigla !== "UN" && fator && fator > 1) {
                    packStr = `${sigla} - ${fator}`;
                } else if (vol && vol > 0 && unit) {
                    packStr = `${vol}${unit}`;
                }

                const price = `R$ ${(parseFloat(p.preco_venda) || 0).toFixed(2).replace(".", ",")}`;
                const desc  = [packStr, price].filter(Boolean).join(" — ");

                // CheckboxGroup só aceita: id, title, description, metadata, enabled, on-click-action
                return {
                    id:          p.id,
                    title:       String(p.product_name ?? "").toUpperCase().slice(0, 30),
                    description: desc.slice(0, 300),
                };
            });
        }

        // Salva a tela atual na sessão para fallback quando Meta enviar screen: ""
        async function saveCatalogScreen(nextScreen: string) {
            // Lê context atual para merge parcial (evita sobrescrever outras chaves)
            const { data: ctxRow } = await admin
                .from("chatbot_sessions")
                .select("context")
                .eq("thread_id", threadId)
                .maybeSingle();
            const ctx = (ctxRow?.context ?? {}) as Record<string, unknown>;
            await admin.from("chatbot_sessions")
                .update({ context: { ...ctx, catalog_screen: nextScreen } })
                .eq("thread_id", threadId);
        }

        // ── INIT → tela CATEGORIES ────────────────────────────────────────────
        if (action === "INIT") {
            const { data: rows, error } = await admin
                .from("products")
                .select("category_id, categories!inner(id, name)")
                .eq("company_id", companyId)
                .eq("is_active", true)
                .not("category_id", "is", null);

            if (error) return encryptedError("db_error", aesKey, iv);

            const counts: Record<string, { name: string; count: number }> = {};
            for (const row of rows ?? []) {
                const cat = (row as any).categories;
                if (!cat?.id) continue;
                if (!counts[cat.id]) counts[cat.id] = { name: cat.name, count: 0 };
                counts[cat.id].count++;
            }

            const categories = Object.entries(counts)
                .map(([id, v]) => ({
                    id,
                    title:       v.name.toUpperCase(),
                    description: `${v.count} produto${v.count !== 1 ? "s" : ""}`,
                }))
                .sort((a, b) => (counts[b.id]?.count ?? 0) - (counts[a.id]?.count ?? 0));

            await saveCatalogScreen("CATEGORIES");
            return encryptedOk(
                { version: "3.0", screen: "CATEGORIES", data: { categories } } as Record<string, unknown>,
                aesKey, iv
            );
        }

        if (action === "data_exchange") {

            // Lê a tela salva na sessão como fallback (Meta pode enviar screen: "")
            const { data: sessionForScreen } = await admin
                .from("chatbot_sessions")
                .select("context")
                .eq("thread_id", threadId)
                .maybeSingle();
            const sessionScreen = String((sessionForScreen?.context as any)?.catalog_screen ?? "").trim().toUpperCase();

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
            async function reRenderCategories() {
                const { data: catRows } = await admin
                    .from("products")
                    .select("category_id, categories!inner(id, name)")
                    .eq("company_id", companyId)
                    .eq("is_active", true)
                    .not("category_id", "is", null);
                const counts: Record<string, { name: string; count: number }> = {};
                for (const row of catRows ?? []) {
                    const cat = (row as any).categories;
                    if (!cat?.id) continue;
                    if (!counts[cat.id]) counts[cat.id] = { name: cat.name, count: 0 };
                    counts[cat.id].count++;
                }
                const categories = Object.entries(counts)
                    .map(([id, v]) => ({ id, title: v.name.toUpperCase(), description: `${v.count} produto${v.count !== 1 ? "s" : ""}` }))
                    .sort((a, b) => (counts[b.id]?.count ?? 0) - (counts[a.id]?.count ?? 0));
                await saveCatalogScreen("CATEGORIES");
                return encryptedOk(
                    { version: "3.0", screen: "CATEGORIES", data: { categories } } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── CATEGORIES → PRODUCTS (busca geral ou por categoria) ──────────
            if (screenNorm === "CATEGORIES") {
                const searchAll  = String(formData?.search_all  ?? "").trim();
                const categoryId = String(formData?.category_id ?? "").trim();

                // Nenhuma opção selecionada: re-renderiza CATEGORIES
                if (!searchAll && !categoryId) {
                    return reRenderCategories();
                }

                let catName    = "";
                let catIdCache = categoryId;

                if (!searchAll && categoryId) {
                    const { data: catRow } = await admin
                        .from("categories")
                        .select("name")
                        .eq("id", categoryId)
                        .maybeSingle();
                    catName = catRow?.name ?? "";
                }

                const products = await fetchProducts(
                    searchAll
                        ? { search: searchAll }
                        : { categoryName: catName }
                );

                if (!products.length) return reRenderCategories();

                const categoryLabel = searchAll
                    ? `Resultados para "${searchAll.toUpperCase()}"`
                    : catName.toUpperCase();

                await saveCatalogScreen("PRODUCTS");
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "PRODUCTS",
                        data: {
                            products,
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

                // Se busca preenchida e nada selecionado → filtra e retorna PRODUCTS de novo
                if (searchFilter && !selectedIds.length) {
                    let catName = "";
                    if (catIdCache) {
                        const { data: catRow } = await admin
                            .from("categories").select("name").eq("id", catIdCache).maybeSingle();
                        catName = catRow?.name ?? "";
                    }

                    const products = await fetchProducts(
                        catIdCache
                            ? { categoryName: catName, search: searchFilter }
                            : { search: searchFilter }
                    );

                    // Sem resultados: re-renderiza com todos os produtos da categoria
                    if (!products.length) {
                        const fallback = await fetchProducts(catIdCache ? { categoryName: catName } : {});
                        await saveCatalogScreen("PRODUCTS");
                        return encryptedOk(
                            { version: "3.0", screen: "PRODUCTS", data: { products: fallback, category_name: catName.toUpperCase() || "PRODUTOS", category_id_cache: catIdCache } } as Record<string, unknown>,
                            aesKey, iv
                        );
                    }

                    const label = catIdCache
                        ? `"${searchFilter.toUpperCase()}" em ${catName.toUpperCase() || "categoria"}`
                        : `Resultados para "${searchFilter.toUpperCase()}"`;

                    await saveCatalogScreen("PRODUCTS");
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
                    let catName2 = "";
                    if (catIdCache) {
                        const { data: catRow2 } = await admin
                            .from("categories").select("name").eq("id", catIdCache).maybeSingle();
                        catName2 = catRow2?.name ?? "";
                    }
                    const reProducts = await fetchProducts(catIdCache ? { categoryName: catName2 } : {});
                    await saveCatalogScreen("PRODUCTS");
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "PRODUCTS",
                            data: {
                                products:          reProducts,
                                category_name:     catName2.toUpperCase() || "PRODUTOS",
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
                        products!inner ( name, is_active )
                    `)
                    .in("id", selectedIds)
                    .eq("company_id", companyId)
                    .eq("products.is_active", true);

                if (prodErr || !validProducts?.length) {
                    console.error("[flows/catalog] invalid_products | prodErr:", prodErr?.message, "| catIdCache:", catIdCache);
                    let catNameFb = "";
                    if (catIdCache) {
                        const { data: catRowFb } = await admin
                            .from("categories").select("name").eq("id", catIdCache).maybeSingle();
                        catNameFb = catRowFb?.name ?? "";
                    }
                    const fbProducts = await fetchProducts(catIdCache ? { categoryName: catNameFb } : {});
                    await saveCatalogScreen("PRODUCTS");
                    return encryptedOk(
                        {
                            version: "3.0",
                            screen:  "PRODUCTS",
                            data: {
                                products:          fbProducts,
                                category_name:     catNameFb.toUpperCase() || "PRODUTOS",
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
                    const sigla = String(p.siglas_comerciais?.sigla ?? "").toUpperCase();
                    const name  = String(p.products.name ?? "").toUpperCase();
                    const price = formatCurrency(parseFloat(p.preco_venda) || 0);
                    const fator = p.fator_conversao;
                    const prefix = sigla && sigla !== "UN"
                        ? (fator && fator > 1 ? `${sigla} - ${fator} • ` : `${sigla} • `)
                        : "";
                    return `${prefix}${name} — ${price}`;
                };

                // Salva IDs na ordem ordenada no contexto da sessão
                await admin
                    .from("chatbot_sessions")
                    .update({
                        step:    "awaiting_flow",
                        context: {
                            source:              "flow_catalog",
                            pending_product_ids: sorted.map((p) => p.id),
                            pending_prices:      sorted.map((p) => parseFloat(p.preco_venda) || 0),
                            pending_names:       sorted.map((p) =>
                                String(p.products.name ?? "").toUpperCase()
                            ),
                        },
                    })
                    .eq("thread_id", threadId)
                    .eq("company_id", companyId);

                // Busca endereços salvos do cliente para pré-popular a tela CEP_SEARCH
                const { data: sessionForAddr } = await admin
                    .from("chatbot_sessions")
                    .select("customer_id")
                    .eq("thread_id", threadId)
                    .maybeSingle();

                type SavedAddr = { id: string; title: string; description: string };
                let savedAddresses: SavedAddr[] = [];
                if (sessionForAddr?.customer_id) {
                    const { data: addrs } = await admin
                        .from("enderecos_cliente")
                        .select("id, apelido, logradouro, numero, bairro")
                        .eq("customer_id", sessionForAddr.customer_id)
                        .eq("company_id", companyId)
                        .order("is_principal", { ascending: false })
                        .limit(5);
                    if (addrs?.length) {
                        savedAddresses = addrs.map((a: any) => ({
                            id:          a.id,
                            title:       a.apelido,
                            description: [a.logradouro, a.numero, a.bairro].filter(Boolean).join(", "),
                        }));
                    }
                }

                // Monta carrinho para exibir no resumo da tela CEP_SEARCH
                const cartForDisplay: CartItem[] = sorted.map((p, i) => ({
                    variantId: p.id,
                    name:      String(p.products.name ?? "").toUpperCase(),
                    qty:       1,
                    price:     parseFloat(p.preco_venda) || 0,
                }));

                await saveCatalogScreen("QUANTITIES");
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
                        },
                    } as Record<string, unknown>,
                    aesKey, iv
                );
            }

            // ── QUANTITIES → aplica quantidades → salva carrinho → CEP_SEARCH ─
            if (screenNorm === "QUANTITIES") {
                const { data: sessionRow } = await admin
                    .from("chatbot_sessions")
                    .select("context")
                    .eq("thread_id", threadId)
                    .maybeSingle();

                const context      = (sessionRow?.context ?? {}) as Record<string, unknown>;
                const pendingIds   = (context.pending_product_ids as string[])  ?? [];
                const pendingPrices = (context.pending_prices      as number[])  ?? [];
                const pendingNames  = (context.pending_names        as string[])  ?? [];

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
                            : parseFloat(String(raw ?? "1").replace(",", ".").trim()) || 1
                    ));
                    return {
                        variantId: id,
                        name:      pendingNames[i] ?? id,
                        qty,
                        price:     pendingPrices[i] ?? 0,
                    };
                });

                console.log("[flows/catalog] QUANTITIES cartItems:", JSON.stringify(cartItems));

                // Salva carrinho final na sessão (sem filtro company_id — thread_id é único)
                const { error: cartSaveErr } = await admin
                    .from("chatbot_sessions")
                    .update({
                        cart:    cartItems,
                        context: {
                            source:              "flow_catalog",
                            pending_product_ids: undefined,
                            pending_prices:      undefined,
                            pending_names:       undefined,
                        },
                    })
                    .eq("thread_id", threadId);

                if (cartSaveErr) {
                    console.error("[flows/catalog] QUANTITIES cart save error:", cartSaveErr.message);
                }

                // Busca endereços salvos para pré-popular a tela CEP_SEARCH
                const { data: qtySessionRow } = await admin
                    .from("chatbot_sessions")
                    .select("customer_id")
                    .eq("thread_id", threadId)
                    .maybeSingle();

                type SavedAddrSlot = { id: string; title: string; description: string };
                let qtySavedAddresses: SavedAddrSlot[] = [];
                if (qtySessionRow?.customer_id) {
                    const { data: addrs } = await admin
                        .from("enderecos_cliente")
                        .select("id, apelido, logradouro, numero, bairro")
                        .eq("customer_id", qtySessionRow.customer_id)
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

                await saveCatalogScreen("CEP_SEARCH");
                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "CEP_SEARCH",
                        data:    {
                            cart_summary:        formatCart(cartItems),
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
                const rawCep            = String(formData?.cep ?? "").replace(/\D/g, "");

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

                        const { data: sessForCart } = await admin
                            .from("chatbot_sessions")
                            .select("cart, context")
                            .eq("thread_id", threadId)
                            .maybeSingle();

                        const cart    = ((sessForCart?.cart ?? []) as CartItem[]);
                        const ctx     = (sessForCart?.context ?? {}) as Record<string, unknown>;
                        const total   = cart.reduce((s, i) => s + i.price * i.qty, 0) + delivFee;
                        const feeText = delivFee > 0
                            ? `\n🛵 Taxa ${zoneRow?.label ?? bairro}: ${formatCurrency(delivFee)}`
                            : "";
                        const cartSummary = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(total)}*`;

                        await admin.from("chatbot_sessions").update({
                            context: {
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
                            },
                        }).eq("thread_id", threadId);

                        await saveCatalogScreen("PAYMENT");
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
                            { signal: AbortSignal.timeout(5000) }
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

                const { data: cepSessRow } = await admin
                    .from("chatbot_sessions")
                    .select("cart")
                    .eq("thread_id", threadId)
                    .maybeSingle();

                const cart = ((cepSessRow?.cart ?? []) as CartItem[]);

                await saveCatalogScreen("ADDRESS");
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

                const totalItems  = cart.reduce((s, i) => s + i.price * i.qty, 0);
                const grandTotal  = totalItems + deliveryFee;
                const feeText     = deliveryFee > 0
                    ? `\n🛵 Taxa ${bairroLabel}: ${formatCurrency(deliveryFee)}`
                    : "";
                const cartSummary = `${formatCart(cart)}${feeText}\n\n💰 *Total: ${formatCurrency(grandTotal)}*`;

                await saveCatalogScreen("PAYMENT");
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
                const changeFor     = trocoStr ? parseFloat(trocoStr.replace(",", ".")) || null : null;

                if (!paymentMethod) {
                    console.error("[flows/catalog] missing_payment_method | threadId:", threadId);
                    await saveCatalogScreen("PAYMENT");
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
                    const { data: threadPhone } = await admin
                        .from("whatsapp_threads")
                        .select("phone_e164, profile_name")
                        .eq("id", threadId)
                        .maybeSingle();

                    if (threadPhone?.phone_e164) {
                        const phoneRaw = threadPhone.phone_e164.replace(/\D/g, "");
                        const { data: existCust } = await admin
                            .from("customers")
                            .select("id")
                            .eq("company_id", companyId)
                            .or(`phone_e164.eq.${threadPhone.phone_e164},phone.eq.${phoneRaw}`)
                            .maybeSingle();

                        if (existCust?.id) {
                            customerId = existCust.id as string;
                        } else {
                            const { data: newCust } = await admin
                                .from("customers")
                                .insert({
                                    company_id: companyId,
                                    phone:      phoneRaw,
                                    phone_e164: threadPhone.phone_e164,
                                    name:       threadPhone.profile_name ?? null,
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

                const { data: threadRow } = await admin
                    .from("whatsapp_threads")
                    .select("phone_e164")
                    .eq("id", threadId)
                    .maybeSingle();

                if (threadRow?.phone_e164) {
                    const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
                    const pmLabel   = pmLabels[paymentMethod] ?? paymentMethod;
                    const feeText   = deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}` : "";
                    const chgText   = changeFor ? ` (troco para ${formatCurrency(changeFor)})` : "";
                    const orderCode = `#${order.id.replace(/-/g, "").slice(-6).toUpperCase()}`;

                    const msg = requireApproval
                        ? `✅ *Pedido Recebido!*\n\nPedido ${orderCode}\nTotal: ${formatCurrency(grandTotal)}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
                        : `✅ *Pedido Confirmado!*\n\nPedido ${orderCode}\n\n${formatCart(cart)}${feeText}\n📍 ${address}\n💳 ${pmLabel}${chgText}\n\n🚚 Previsão: 30-40 min\n\nObrigado pela preferência! 🍺`;

                    await sendWhatsAppMessage(threadRow.phone_e164, msg, waConfig);
                }

                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "SUCCESS",
                        data:    { order_code: `#${order.id.replace(/-/g, "").slice(-6).toUpperCase()}` },
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
            const rawCep = String(formData?.cep ?? "").replace(/\D/g, "");

            let ruaInit    = "";
            let bairroInit = "";

            if (rawCep.length === 8) {
                try {
                    const viaCepRes  = await fetch(
                        `https://viacep.com.br/ws/${rawCep}/json/`,
                        { signal: AbortSignal.timeout(5000) }
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
            const changeFor     = trocoStr ? parseFloat(trocoStr.replace(",", ".")) || null : null;

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

            // Busca telefone da thread
            const { data: threadRow } = await admin
                .from("whatsapp_threads")
                .select("phone_e164")
                .eq("id", threadId)
                .maybeSingle();

            const phoneE164 = threadRow?.phone_e164 ?? null;

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
                    const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
                    const pmLabel = pmLabels[paymentMethod] ?? paymentMethod;
                    const feeText = deliveryFee > 0
                        ? `\n🛵 Taxa de entrega: ${formatCurrency(deliveryFee)}`
                        : "";
                    const changeText = changeFor
                        ? ` (troco para ${formatCurrency(changeFor)})`
                        : "";

                    const msg = requireApproval
                        ? `✅ *Pedido Recebido!*\n\nPedido #${order.id.replace(/-/g, "").slice(-6).toUpperCase()}\nTotal: ${formatCurrency(grandTotal)}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
                        : `✅ *Pedido Confirmado!*\n\nPedido #${order.id.replace(/-/g, "").slice(-6).toUpperCase()}\n\n${formatCart(cart)}${feeText}\n📍 ${address}\n💳 ${pmLabel}${changeText}\n\n🚚 Previsão: 30-40 min\n\nObrigado pela preferência! 🍺`;

                    await sendWhatsAppMessage(phoneE164, msg, waConfig);
                }

                return encryptedOk(
                    {
                        version: "3.0",
                        screen:  "SUCCESS",
                        data:    { order_code: `#${order.id.replace(/-/g, "").slice(-6).toUpperCase()}` },
                    },
                    aesKey, iv
                );
            }

            // ──────────────────────────────────────────────────────────────────
            // CAMINHO CHATBOT: envia resumo + lista de confirmação (comportamento original)
            // ──────────────────────────────────────────────────────────────────
            if (phoneE164) {
                const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
                const paymentLabel = pmLabels[paymentMethod] ?? paymentMethod;
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
