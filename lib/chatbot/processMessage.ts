/**
 * lib/chatbot/processMessage.ts
 *
 * Engine do chatbot com estado para disk bebidas via WhatsApp.
 *
 * Fluxo principal:
 *   welcome → main_menu → catalog_categories → catalog_products
 *   → cart → checkout_address → checkout_payment → checkout_confirm → done
 *
 * Chamado diretamente pelos webhooks (sem HTTP, sem cookies de sessão).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage } from "@/lib/whatsapp/sendMessage";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ProcessMessageParams {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    messageId: string;
    phoneE164: string;
    text: string;
    profileName?: string | null;
}

interface CartItem {
    variantId: string;
    productId: string;
    name: string;         // "Heineken 600ml"
    price: number;
    qty: number;
}

interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, any>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string) {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function matchesAny(input: string, keywords: string[]) {
    const n = normalize(input);
    return keywords.some((k) => n.includes(normalize(k)));
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

function cartTotal(cart: CartItem[]) {
    return cart.reduce((acc, i) => acc + i.price * i.qty, 0);
}

function formatCart(cart: CartItem[]) {
    if (!cart.length) return "Seu carrinho está vazio.";
    const lines = cart.map(
        (i) => `• ${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`
    );
    lines.push(`\n*Total: ${formatCurrency(cartTotal(cart))}*`);
    return lines.join("\n");
}

// Levenshtein simples para fuzzy matching sem pg_trgm no JS
function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1][j - 1]
                    : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

function fuzzyMatch(input: string, candidate: string): number {
    const a = normalize(input);
    const b = normalize(candidate);
    if (b.includes(a) || a.includes(b)) return 1.0;
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1.0 : 1 - dist / maxLen;
}

// ─── Dados do banco ───────────────────────────────────────────────────────────

async function getOrCreateSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string
): Promise<Session> {
    // Tenta buscar sessão ativa (não expirada)
    const { data } = await admin
        .from("chatbot_sessions")
        .select("*")
        .eq("thread_id", threadId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (data) {
        return {
            id: data.id,
            step: data.step,
            cart: (data.cart as CartItem[]) ?? [],
            customer_id: data.customer_id ?? null,
            context: (data.context as Record<string, any>) ?? {},
        };
    }

    // Cria nova sessão
    const { data: created, error } = await admin
        .from("chatbot_sessions")
        .upsert(
            {
                thread_id:  threadId,
                company_id: companyId,
                step:       "welcome",
                cart:       [],
                context:    {},
                expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            },
            { onConflict: "thread_id" }
        )
        .select("*")
        .single();

    if (error || !created) {
        // Fallback: retorna sessão em memória
        return { id: "", step: "welcome", cart: [], customer_id: null, context: {} };
    }

    return {
        id: created.id,
        step: created.step,
        cart: (created.cart as CartItem[]) ?? [],
        customer_id: created.customer_id ?? null,
        context: (created.context as Record<string, any>) ?? {},
    };
}

async function saveSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    updates: Partial<Omit<Session, "id">>
) {
    await admin
        .from("chatbot_sessions")
        .upsert(
            {
                thread_id:   threadId,
                company_id:  companyId,
                step:        updates.step,
                cart:        updates.cart,
                customer_id: updates.customer_id,
                context:     updates.context,
                expires_at:  new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                updated_at:  new Date().toISOString(),
            },
            { onConflict: "thread_id" }
        );
}

async function getCompanyInfo(admin: SupabaseClient, companyId: string) {
    const { data } = await admin
        .from("companies")
        .select("name, settings")
        .eq("id", companyId)
        .maybeSingle();
    return data;
}

async function getCategories(admin: SupabaseClient, companyId: string) {
    const { data } = await admin
        .from("categories")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name");
    return data ?? [];
}

async function getProductsByCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryId: string
) {
    const { data } = await admin
        .from("products")
        .select(`
            id, name,
            product_variants (id, volume_value, unit_price, unit_type)
        `)
        .eq("company_id", companyId)
        .eq("category_id", categoryId)
        .eq("is_active", true)
        .order("name");
    return data ?? [];
}

async function searchProducts(
    admin: SupabaseClient,
    companyId: string,
    query: string
) {
    // Busca textual simples primeiro; pg_trgm está disponível no banco
    const { data } = await admin
        .from("products")
        .select(`
            id, name,
            product_variants (id, volume_value, unit_price, unit_type)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .ilike("name", `%${query}%`)
        .limit(8);

    if (data && data.length > 0) return data;

    // Fallback: busca todos e aplica fuzzy no JS
    const { data: all } = await admin
        .from("products")
        .select(`
            id, name,
            product_variants (id, volume_value, unit_price, unit_type)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true);

    if (!all) return [];

    return all
        .map((p) => ({ ...p, _score: fuzzyMatch(query, p.name) }))
        .filter((p) => p._score > 0.4)
        .sort((a, b) => b._score - a._score)
        .slice(0, 6);
}

async function getOrCreateCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneE164: string,
    name?: string | null
) {
    const { data: existing } = await admin
        .from("customers")
        .select("id, name, address, delivery_address")
        .eq("company_id", companyId)
        .eq("phone", phoneE164)
        .maybeSingle();

    if (existing) return existing;

    const { data: created } = await admin
        .from("customers")
        .insert({
            company_id: companyId,
            phone:      phoneE164,
            name:       name ?? "Cliente WhatsApp",
        })
        .select("id, name, address, delivery_address")
        .single();

    return created;
}

async function createOrder(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    cart: CartItem[],
    paymentMethod: string,
    deliveryAddress: string
) {
    const total = cartTotal(cart);

    const { data: order, error } = await admin
        .from("orders")
        .insert({
            company_id:       companyId,
            customer_id:      customerId,
            status:           "new",
            channel:          "whatsapp",
            payment_method:   paymentMethod,
            delivery_address: deliveryAddress,
            total_amount:     total,
            notes:            "Pedido via chatbot WhatsApp",
        })
        .select("id")
        .single();

    if (error || !order) throw new Error(error?.message ?? "Falha ao criar pedido");

    // Itens do pedido
    const items = cart.map((item) => ({
        order_id:           order.id,
        product_variant_id: item.variantId,
        product_id:         item.productId,
        quantity:           item.qty,
        unit_price:         item.price,
        subtotal:           item.price * item.qty,
    }));

    await admin.from("order_items").insert(items);

    return order.id;
}

// ─── Verificação de horário de funcionamento ──────────────────────────────────

function isWithinBusinessHours(settings: any): boolean {
    if (!settings?.business_hours) return true; // sem configuração = sempre aberto

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Dom ... 6=Sáb
    const hour = now.getHours();
    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const dayKey = dayNames[dayOfWeek];

    const dayConfig = settings.business_hours[dayKey];
    if (!dayConfig || !dayConfig.open) return false;

    const [openH, openM]   = String(dayConfig.from ?? "08:00").split(":").map(Number);
    const [closeH, closeM] = String(dayConfig.to ?? "22:00").split(":").map(Number);

    const openMinutes  = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;
    const nowMinutes   = hour * 60 + now.getMinutes();

    return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

// ─── Envio helper (inclui contabilização de uso) ──────────────────────────────

async function reply(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    text: string
) {
    const result = await sendWhatsAppMessage({
        admin,
        companyId,
        toPhone: phoneE164,
        text,
        threadId,
    });

    // Contabiliza uso (sem checagem de limite — mensagens do bot)
    try {
        await admin.rpc("increment_usage_monthly", {
            p_company: companyId,
            p_feature: "whatsapp_messages",
            p_used:    1,
        });
    } catch {
        // não bloqueia o fluxo
    }

    return result;
}

// ─── Máquina de estados ───────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, text, profileName } = params;

    const input = text.trim();
    if (!input) return;

    // Busca info da empresa e chatbot ativo
    const [company, botRows] = await Promise.all([
        getCompanyInfo(admin, companyId),
        admin
            .from("chatbots")
            .select("id, config")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .limit(1)
            .then((r) => r.data ?? []),
    ]);

    const companyName = company?.name ?? "nossa loja";
    const settings    = company?.settings ?? {};

    // Se não há bot ativo, ignora
    if (!botRows.length) return;

    // Carrega ou cria sessão
    const session = await getOrCreateSession(admin, threadId, companyId);

    // Comandos globais (qualquer etapa)
    if (matchesAny(input, ["cancelar", "cancel", "reiniciar", "menu", "inicio", "começar"])) {
        await saveSession(admin, threadId, companyId, {
            step: "main_menu",
            cart: [],
            context: {},
            customer_id: session.customer_id,
        });
        await reply(admin, companyId, threadId, phoneE164, buildMainMenu(companyName));
        return;
    }

    if (matchesAny(input, ["atendente", "humano", "pessoa", "falar com alguem", "ajuda"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // Roteamento por etapa
    switch (session.step) {
        case "welcome":
        case "main_menu":
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, session, profileName);
            break;

        case "catalog_categories":
            await handleCatalogCategories(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "catalog_products":
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "cart":
            await handleCart(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "checkout_address":
            await handleCheckoutAddress(admin, companyId, threadId, phoneE164, companyName, input, session, profileName);
            break;

        case "checkout_payment":
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "checkout_confirm":
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "handover":
            // Thread com humano — bot fica em silêncio
            break;

        case "done":
            // Pedido já feito — volta ao menu
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {}, customer_id: session.customer_id });
            await reply(admin, companyId, threadId, phoneE164, buildMainMenu(companyName));
            break;

        default:
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {}, customer_id: session.customer_id });
            await reply(admin, companyId, threadId, phoneE164, buildMainMenu(companyName));
    }
}

// ─── Handlers por etapa ───────────────────────────────────────────────────────

function buildMainMenu(companyName: string) {
    return (
        `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\n` +
        `Como posso te ajudar?\n\n` +
        `1️⃣  Ver cardápio\n` +
        `2️⃣  Status do meu pedido\n` +
        `3️⃣  Falar com atendente\n\n` +
        `_Responda com o número da opção._`
    );
}

async function handleMainMenu(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    settings: any,
    input: string,
    session: Session,
    profileName?: string | null
) {
    // Primeira mensagem ou qualquer texto que não seja comando → boas-vindas
    if (session.step === "welcome") {
        if (!isWithinBusinessHours(settings)) {
            const msg =
                settings?.closed_message ??
                `Olá! No momento estamos fechados. Em breve voltamos a atender. 😊`;
            await reply(admin, companyId, threadId, phoneE164, msg);
            return;
        }
        await saveSession(admin, threadId, companyId, { ...session, step: "main_menu" });
        await reply(admin, companyId, threadId, phoneE164, buildMainMenu(companyName));
        return;
    }

    if (input === "1" || matchesAny(input, ["cardapio", "produtos", "bebidas", "ver"])) {
        const categories = await getCategories(admin, companyId);

        if (!categories.length) {
            await reply(
                admin, companyId, threadId, phoneE164,
                "Ops! Nenhuma categoria cadastrada ainda. Tente mais tarde. 😅"
            );
            return;
        }

        const list = categories
            .map((c, i) => `${i + 1}️⃣  ${c.name}`)
            .join("\n");

        await saveSession(admin, threadId, companyId, {
            ...session,
            step:    "catalog_categories",
            context: { categories: categories.map((c) => ({ id: c.id, name: c.name })) },
        });

        await reply(
            admin, companyId, threadId, phoneE164,
            `*Categorias disponíveis:*\n\n${list}\n\n_Responda com o número da categoria ou digite o nome de um produto para buscar._`
        );
        return;
    }

    if (input === "2" || matchesAny(input, ["status", "pedido", "onde", "acompanhar"])) {
        // Busca último pedido do cliente
        const customer = await getOrCreateCustomer(admin, companyId, phoneE164, profileName);
        if (!customer) {
            await reply(admin, companyId, threadId, phoneE164, "Não encontrei pedidos para o seu número. 😅");
            return;
        }

        const { data: lastOrder } = await admin
            .from("orders")
            .select("id, status, created_at, total_amount")
            .eq("company_id", companyId)
            .eq("customer_id", customer.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastOrder) {
            await reply(admin, companyId, threadId, phoneE164, "Você ainda não fez nenhum pedido por aqui. 😊\nDigite *1* para ver o cardápio!");
            return;
        }

        const statusLabels: Record<string, string> = {
            new:        "✅ Recebido",
            confirmed:  "✅ Confirmado",
            preparing:  "🔥 Em preparo",
            delivering: "🛵 Saiu para entrega",
            delivered:  "📦 Entregue",
            cancelled:  "❌ Cancelado",
        };

        const label = statusLabels[lastOrder.status] ?? lastOrder.status;
        const date  = new Date(lastOrder.created_at).toLocaleString("pt-BR");

        await reply(
            admin, companyId, threadId, phoneE164,
            `*Seu último pedido:*\n\n📋 Status: ${label}\n💰 Total: ${formatCurrency(lastOrder.total_amount)}\n📅 Data: ${date}`
        );
        return;
    }

    if (input === "3" || matchesAny(input, ["atendente", "humano"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // Texto livre → tenta buscar produto diretamente
    if (input.length >= 3) {
        const products = await searchProducts(admin, companyId, input);
        if (products.length) {
            await saveSession(admin, threadId, companyId, {
                ...session,
                step:    "catalog_products",
                context: { products: buildProductList(products), category_name: "Busca" },
            });
            await reply(
                admin, companyId, threadId, phoneE164,
                buildProductsMessage(products, "Resultados para: " + input)
            );
            return;
        }
    }

    // Input inválido
    await reply(admin, companyId, threadId, phoneE164, buildMainMenu(companyName));
}

async function handleCatalogCategories(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
) {
    const categories: { id: string; name: string }[] =
        session.context.categories ?? [];

    // Seleção por número
    const num = parseInt(input, 10);
    let selectedCategory: { id: string; name: string } | null = null;

    if (!isNaN(num) && num >= 1 && num <= categories.length) {
        selectedCategory = categories[num - 1];
    } else {
        // Busca fuzzy no nome da categoria
        const match = categories
            .map((c) => ({ ...c, score: fuzzyMatch(input, c.name) }))
            .filter((c) => c.score > 0.5)
            .sort((a, b) => b.score - a.score)[0];
        if (match) selectedCategory = match;
    }

    if (!selectedCategory) {
        // Tentativa de busca de produto diretamente
        if (input.length >= 3) {
            const products = await searchProducts(admin, companyId, input);
            if (products.length) {
                await saveSession(admin, threadId, companyId, {
                    ...session,
                    step:    "catalog_products",
                    context: { ...session.context, products: buildProductList(products), category_name: "Busca" },
                });
                await reply(admin, companyId, threadId, phoneE164, buildProductsMessage(products, "Resultados para: " + input));
                return;
            }
        }

        const list = categories.map((c, i) => `${i + 1}️⃣  ${c.name}`).join("\n");
        await reply(
            admin, companyId, threadId, phoneE164,
            `Não entendi. Escolha uma categoria:\n\n${list}`
        );
        return;
    }

    const products = await getProductsByCategory(admin, companyId, selectedCategory.id);

    if (!products.length) {
        await reply(
            admin, companyId, threadId, phoneE164,
            `Nenhum produto em *${selectedCategory.name}* no momento. Digite *menu* para voltar.`
        );
        return;
    }

    await saveSession(admin, threadId, companyId, {
        ...session,
        step:    "catalog_products",
        context: {
            ...session.context,
            products:      buildProductList(products),
            category_name: selectedCategory.name,
        },
    });

    await reply(
        admin, companyId, threadId, phoneE164,
        buildProductsMessage(products, selectedCategory.name)
    );
}

function buildProductList(products: any[]): any[] {
    const list: any[] = [];
    let idx = 1;
    for (const p of products) {
        const variants: any[] = Array.isArray(p.product_variants)
            ? p.product_variants
            : [];
        if (variants.length === 0) {
            list.push({ idx: idx++, productId: p.id, variantId: p.id, name: p.name, price: p.price ?? 0 });
        } else {
            for (const v of variants) {
                const label = v.volume_value
                    ? `${p.name} ${v.volume_value}${v.unit_type ?? "ml"}`
                    : p.name;
                list.push({
                    idx:       idx++,
                    productId: p.id,
                    variantId: v.id,
                    name:      label,
                    price:     v.unit_price ?? p.price ?? 0,
                });
            }
        }
    }
    return list;
}

function buildProductsMessage(products: any[], title: string) {
    const lines: string[] = [`*${title}*\n`];
    let idx = 1;
    for (const p of products) {
        const variants: any[] = Array.isArray(p.product_variants)
            ? p.product_variants
            : [];
        if (variants.length === 0) {
            lines.push(`${idx++}. ${p.name} — ${formatCurrency(p.price ?? 0)}`);
        } else {
            for (const v of variants) {
                const label = v.volume_value
                    ? `${p.name} ${v.volume_value}${v.unit_type ?? "ml"}`
                    : p.name;
                lines.push(`${idx++}. ${label} — ${formatCurrency(v.unit_price ?? p.price ?? 0)}`);
            }
        }
    }
    lines.push(
        "\n_Digite o *número* do item para adicionar ao carrinho._\n" +
        "_Digite *carrinho* para ver o carrinho ou *menu* para voltar._"
    );
    return lines.join("\n");
}

async function handleCatalogProducts(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
) {
    const products: any[] = session.context.products ?? [];

    if (matchesAny(input, ["carrinho", "ver carrinho", "finalizar", "checkout"])) {
        await goToCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > products.length) {
        const msg =
            `Não entendi. Digite o *número* do produto para adicionar ao carrinho.\n` +
            `Ex: *1* para adicionar o primeiro item.\n` +
            `Ou *menu* para voltar ao início.`;
        await reply(admin, companyId, threadId, phoneE164, msg);
        return;
    }

    const selected = products[num - 1];

    // Pergunta a quantidade
    await saveSession(admin, threadId, companyId, {
        ...session,
        context: { ...session.context, pending_product: selected },
    });

    await reply(
        admin, companyId, threadId, phoneE164,
        `Ótima escolha! *${selected.name}* — ${formatCurrency(selected.price)}\n\nQuantas unidades? (Digite um número)`
    );
}

async function handleCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
) {
    // Se há produto pendente de quantidade, captura a quantidade
    if (session.context.pending_product) {
        const qty = parseInt(input, 10);
        if (isNaN(qty) || qty < 1 || qty > 99) {
            await reply(admin, companyId, threadId, phoneE164, "Digite uma quantidade válida (entre 1 e 99).");
            return;
        }

        const pending = session.context.pending_product;
        const newCart = [...session.cart];
        const existing = newCart.findIndex((i) => i.variantId === pending.variantId);

        if (existing >= 0) {
            newCart[existing].qty += qty;
        } else {
            newCart.push({
                variantId: pending.variantId,
                productId: pending.productId,
                name:      pending.name,
                price:     pending.price,
                qty,
            });
        }

        await saveSession(admin, threadId, companyId, {
            ...session,
            step:    "catalog_products",
            cart:    newCart,
            context: { ...session.context, pending_product: null },
        });

        await reply(
            admin, companyId, threadId, phoneE164,
            `✅ *${qty}x ${pending.name}* adicionado!\n\n` +
            `${formatCart(newCart)}\n\n` +
            `_Continue escolhendo ou digite *finalizar* para fechar o pedido._`
        );
        return;
    }

    if (matchesAny(input, ["finalizar", "fechar", "checkout", "pedido"])) {
        if (!session.cart.length) {
            await reply(admin, companyId, threadId, phoneE164, "Seu carrinho está vazio. Digite *1* para ver o cardápio.");
            return;
        }
        await goToCheckoutAddress(admin, companyId, threadId, phoneE164, session);
        return;
    }

    if (matchesAny(input, ["limpar", "esvaziar", "cancelar carrinho"])) {
        await saveSession(admin, threadId, companyId, { ...session, step: "main_menu", cart: [] });
        await reply(admin, companyId, threadId, phoneE164, "Carrinho esvaziado. " + buildMainMenu(companyName));
        return;
    }

    // Remove item (ex: "remover 2")
    const removeMatch = normalize(input).match(/^(remover|tirar|deletar)\s+(\d+)$/);
    if (removeMatch) {
        const idx = parseInt(removeMatch[2], 10) - 1;
        if (idx >= 0 && idx < session.cart.length) {
            const newCart = session.cart.filter((_, i) => i !== idx);
            await saveSession(admin, threadId, companyId, { ...session, cart: newCart });
            await reply(
                admin, companyId, threadId, phoneE164,
                `Item removido.\n\n${formatCart(newCart)}\n\n_Digite *finalizar* para fechar o pedido ou *menu* para continuar comprando._`
            );
            return;
        }
    }

    // Exibe carrinho
    await goToCart(admin, companyId, threadId, phoneE164, session);
}

async function goToCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
) {
    if (!session.cart.length) {
        await saveSession(admin, threadId, companyId, { ...session, step: "main_menu" });
        await reply(admin, companyId, threadId, phoneE164, "Carrinho vazio. " + buildMainMenu(""));
        return;
    }

    await saveSession(admin, threadId, companyId, { ...session, step: "cart" });
    await reply(
        admin, companyId, threadId, phoneE164,
        `🛒 *Seu carrinho:*\n\n${formatCart(session.cart)}\n\n` +
        `Digite *finalizar* para fechar o pedido\n` +
        `Digite *remover N* para remover um item\n` +
        `Digite *menu* para continuar comprando`
    );
}

async function goToCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
) {
    // Verifica se o cliente tem endereço salvo
    const customer = await getOrCreateCustomer(admin, companyId, phoneE164);
    const savedAddress = (customer as any)?.delivery_address ?? (customer as any)?.address ?? null;

    if (savedAddress) {
        await saveSession(admin, threadId, companyId, {
            ...session,
            step:        "checkout_payment",
            customer_id: (customer as any)?.id ?? session.customer_id,
            context:     { ...session.context, delivery_address: savedAddress },
        });

        await reply(
            admin, companyId, threadId, phoneE164,
            `📍 *Endereço de entrega:*\n${savedAddress}\n\n` +
            `_Confirmo este endereço?_\n\n` +
            `1️⃣  Sim, usar este endereço\n` +
            `2️⃣  Informar outro endereço`
        );
    } else {
        await saveSession(admin, threadId, companyId, {
            ...session,
            step:        "checkout_address",
            customer_id: (customer as any)?.id ?? session.customer_id,
        });

        await reply(
            admin, companyId, threadId, phoneE164,
            `📍 Qual é o seu endereço de entrega?\n\n_Ex: Rua das Flores, 123, Bairro Centro_`
        );
    }
}

async function handleCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session,
    profileName?: string | null
) {
    // Confirmação de endereço salvo
    if (input === "1") {
        const savedAddress = session.context.delivery_address;
        if (savedAddress) {
            await saveSession(admin, threadId, companyId, {
                ...session,
                step:    "checkout_payment",
                context: { ...session.context, delivery_address: savedAddress },
            });
            await sendPaymentOptions(admin, companyId, threadId, phoneE164);
            return;
        }
    }

    if (input === "2" || !session.context.delivery_address) {
        await saveSession(admin, threadId, companyId, {
            ...session,
            step:    "checkout_address",
            context: { ...session.context, delivery_address: null },
        });
        await reply(admin, companyId, threadId, phoneE164, `📍 Informe o endereço de entrega:\n\n_Ex: Rua das Flores, 123, Bairro Centro_`);
        return;
    }

    // Endereço digitado pelo cliente
    if (input.length < 10) {
        await reply(admin, companyId, threadId, phoneE164, "Por favor, informe o endereço completo (rua, número e bairro).");
        return;
    }

    // Atualiza endereço no cliente
    if (session.customer_id) {
        await admin.from("customers").update({ delivery_address: input }).eq("id", session.customer_id);
    }

    await saveSession(admin, threadId, companyId, {
        ...session,
        step:    "checkout_payment",
        context: { ...session.context, delivery_address: input },
    });

    await sendPaymentOptions(admin, companyId, threadId, phoneE164);
}

async function sendPaymentOptions(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string
) {
    await reply(
        admin, companyId, threadId, phoneE164,
        `💳 *Forma de pagamento:*\n\n` +
        `1️⃣  Pix\n` +
        `2️⃣  Dinheiro\n` +
        `3️⃣  Cartão na entrega`
    );
}

async function handleCheckoutPayment(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
) {
    const paymentMap: Record<string, string> = {
        "1": "pix",
        "2": "dinheiro",
        "3": "cartao",
        "pix": "pix",
        "dinheiro": "dinheiro",
        "cartao": "cartao",
        "cartão": "cartao",
        "credito": "cartao",
        "debito": "cartao",
    };

    const method = paymentMap[normalize(input)];
    if (!method) {
        await sendPaymentOptions(admin, companyId, threadId, phoneE164);
        return;
    }

    const paymentLabels: Record<string, string> = {
        pix:     "Pix",
        dinheiro: "Dinheiro",
        cartao:  "Cartão na entrega",
    };

    const address = session.context.delivery_address ?? "—";

    await saveSession(admin, threadId, companyId, {
        ...session,
        step:    "checkout_confirm",
        context: { ...session.context, payment_method: method },
    });

    await reply(
        admin, companyId, threadId, phoneE164,
        `📋 *Resumo do pedido:*\n\n` +
        `${formatCart(session.cart)}\n\n` +
        `📍 Entrega: ${address}\n` +
        `💳 Pagamento: ${paymentLabels[method]}\n\n` +
        `_Confirmar pedido?_\n\n` +
        `✅ Digite *confirmar* para finalizar\n` +
        `❌ Digite *cancelar* para voltar`
    );
}

async function handleCheckoutConfirm(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
) {
    if (!matchesAny(input, ["confirmar", "confirmo", "sim", "ok", "feito", "1"])) {
        await saveSession(admin, threadId, companyId, { ...session, step: "main_menu", cart: [] });
        await reply(admin, companyId, threadId, phoneE164, `Pedido cancelado. ` + buildMainMenu(companyName));
        return;
    }

    try {
        const customerId  = session.customer_id!;
        const address     = session.context.delivery_address ?? "";
        const paymentMethod = session.context.payment_method ?? "dinheiro";

        const orderId = await createOrder(
            admin, companyId, customerId, session.cart, paymentMethod, address
        );

        await saveSession(admin, threadId, companyId, {
            ...session,
            step:    "done",
            cart:    [],
            context: { ...session.context, last_order_id: orderId },
        });

        await reply(
            admin, companyId, threadId, phoneE164,
            `✅ *Pedido confirmado!*\n\n` +
            `${formatCart(session.cart)}\n\n` +
            `📦 Seu pedido foi recebido e já está sendo preparado.\n` +
            `🛵 Assim que sair para entrega, você será avisado!\n\n` +
            `_Obrigado por pedir com a gente! 🍺_`
        );

    } catch (err: any) {
        console.error("Erro ao criar pedido:", err);
        await reply(
            admin, companyId, threadId, phoneE164,
            `Desculpe, houve um erro ao registrar seu pedido. Por favor, tente novamente ou fale com um atendente. 😞`
        );
    }
}

async function doHandover(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
) {
    await Promise.all([
        // Marca thread como em handover (bot silencia)
        admin.from("whatsapp_threads").update({
            handover_at: new Date().toISOString(),
            bot_active:  false,
        }).eq("id", threadId),

        // Salva sessão no estado handover
        saveSession(admin, threadId, companyId, { ...session, step: "handover" }),
    ]);

    await reply(
        admin, companyId, threadId, phoneE164,
        `👋 Vou te conectar com um atendente. Aguarde um momento!\n\n` +
        `_Um de nossos atendentes responderá em breve._`
    );
}
