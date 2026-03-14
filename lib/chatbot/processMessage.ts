/**
 * lib/chatbot/processMessage.ts
 *
 * Motor completo do chatbot de disk bebidas via WhatsApp + Meta Cloud API.
 *
 * Fluxo:
 *   welcome → main_menu → catalog_categories → catalog_products
 *   → cart → checkout_address → checkout_payment → checkout_confirm → done
 *                                                                     ↘ handover
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppMessage, sendInteractiveButtons, sendListMessage } from "@/lib/whatsapp/send";

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
    name: string;   // ex: "Heineken 600ml"
    price: number;
    qty: number;
}

interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, unknown>;
}

// ─── Helpers de texto ─────────────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function matchesAny(input: string, keywords: string[]): boolean {
    const n = normalize(input);
    return keywords.some((k) => n.includes(normalize(k)));
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);
}

function cartTotal(cart: CartItem[]): number {
    return cart.reduce((acc, i) => acc + i.price * i.qty, 0);
}

function formatCart(cart: CartItem[]): string {
    if (!cart.length) return "Seu carrinho está vazio.";
    const lines = cart.map(
        (i, idx) => `${idx + 1}. ${i.qty}x ${i.name} — ${formatCurrency(i.price * i.qty)}`
    );
    lines.push(`\n*Total: ${formatCurrency(cartTotal(cart))}*`);
    return lines.join("\n");
}

// ─── DB: Sessão ───────────────────────────────────────────────────────────────

async function getOrCreateSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string
): Promise<Session> {
    const { data } = await admin
        .from("chatbot_sessions")
        .select("id, step, cart, customer_id, context")
        .eq("thread_id", threadId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    if (data) {
        return {
            id:          data.id,
            step:        data.step ?? "welcome",
            cart:        (data.cart as CartItem[]) ?? [],
            customer_id: data.customer_id ?? null,
            context:     (data.context as Record<string, unknown>) ?? {},
        };
    }

    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const { data: created } = await admin
        .from("chatbot_sessions")
        .upsert(
            {
                thread_id:  threadId,
                company_id: companyId,
                step:       "welcome",
                cart:       [],
                context:    {},
                expires_at: expiresAt,
            },
            { onConflict: "thread_id" }
        )
        .select("id, step, cart, customer_id, context")
        .single();

    return {
        id:          created?.id ?? "",
        step:        created?.step ?? "welcome",
        cart:        [],
        customer_id: null,
        context:     {},
    };
}

async function saveSession(
    admin: SupabaseClient,
    threadId: string,
    companyId: string,
    patch: Partial<Omit<Session, "id">>
): Promise<void> {
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    await admin.from("chatbot_sessions").upsert(
        {
            thread_id:   threadId,
            company_id:  companyId,
            expires_at:  expiresAt,
            updated_at:  new Date().toISOString(),
            ...(patch.step        !== undefined && { step:        patch.step }),
            ...(patch.cart        !== undefined && { cart:        patch.cart }),
            ...(patch.customer_id !== undefined && { customer_id: patch.customer_id }),
            ...(patch.context     !== undefined && { context:     patch.context }),
        },
        { onConflict: "thread_id" }
    );
}

// ─── DB: Empresa ──────────────────────────────────────────────────────────────

async function getCompanyInfo(
    admin: SupabaseClient,
    companyId: string
): Promise<{ name: string; settings: Record<string, unknown> } | null> {
    const { data } = await admin
        .from("companies")
        .select("name, settings")
        .eq("id", companyId)
        .maybeSingle();

    return data
        ? { name: data.name ?? "nossa loja", settings: (data.settings as Record<string, unknown>) ?? {} }
        : null;
}

// ─── DB: Cardápio ─────────────────────────────────────────────────────────────

interface Category {
    id: string;
    name: string;
}

async function getCategories(admin: SupabaseClient): Promise<Category[]> {
    // categories não tem company_id — são globais ao banco
    const { data } = await admin
        .from("categories")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

    return (data as Category[]) ?? [];
}

interface ProductOption {
    idx: number;
    productId: string;
    variantId: string;
    name: string;   // "Heineken 600ml"
    price: number;
}

async function getProductsByCategory(
    admin: SupabaseClient,
    categoryId: string
): Promise<ProductOption[]> {
    const { data } = await admin
        .from("products")
        .select(`
            id,
            name,
            product_variants (
                id,
                volume_value,
                unit,
                unit_price,
                is_active
            )
        `)
        .eq("category_id", categoryId)
        .eq("is_active", true)
        .order("name")
        .limit(12);

    if (!data?.length) return [];

    const options: ProductOption[] = [];
    let idx = 1;

    for (const p of data as any[]) {
        const variants: any[] = Array.isArray(p.product_variants)
            ? p.product_variants.filter((v: any) => v.is_active !== false)
            : [];

        if (!variants.length) {
            options.push({ idx: idx++, productId: p.id, variantId: p.id, name: p.name, price: 0 });
        } else {
            for (const v of variants) {
                const vol   = v.volume_value ? `${v.volume_value}${v.unit ?? "ml"}` : null;
                const label = vol ? `${p.name} ${vol}` : p.name;
                options.push({ idx: idx++, productId: p.id, variantId: v.id, name: label, price: Number(v.unit_price ?? 0) });
                if (idx > 10) break;
            }
        }
        if (idx > 10) break;
    }

    return options;
}

// ─── DB: Cliente ──────────────────────────────────────────────────────────────

interface Customer {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
}

async function getOrCreateCustomer(
    admin: SupabaseClient,
    phoneE164: string,
    name?: string | null
): Promise<Customer | null> {
    const phoneClean = phoneE164.replace(/\D/g, "");

    const { data: existing } = await admin
        .from("customers")
        .select("id, name, phone, address")
        .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
        .limit(1)
        .maybeSingle();

    if (existing) return existing as Customer;

    const { data: created, error } = await admin
        .from("customers")
        .insert({ name: name ?? "Cliente WhatsApp", phone: phoneE164 })
        .select("id, name, phone, address")
        .single();

    if (error) {
        console.error("[chatbot] Erro ao criar customer:", error.message);
        return null;
    }

    return created as Customer;
}

// ─── DB: Pedido ───────────────────────────────────────────────────────────────

/**
 * payment_method aceita: "pix" | "cash" | "card"
 * orders não tem delivery_address — endereço fica em `details`
 */
async function createOrder(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    cart: CartItem[],
    paymentMethod: string,
    deliveryAddress: string,
    changeFor?: number | null
): Promise<string> {
    const total = cartTotal(cart);

    console.log("[createOrder] START | companyId:", companyId, "| customerId:", customerId,
        "| paymentMethod:", paymentMethod, "| total:", total,
        "| items:", cart.length, "| address:", deliveryAddress, "| changeFor:", changeFor ?? null);

    const orderPayload = {
        company_id:     companyId,
        customer_id:    customerId,
        status:         "new",
        channel:        "whatsapp",
        payment_method: paymentMethod,
        paid:           false,
        delivery_fee:   0,
        total_amount:   total,
        details:        `Endereço: ${deliveryAddress}${changeFor ? ` | Troco: R$ ${changeFor.toFixed(2)}` : ""}`,
    };
    console.log("[createOrder] payload:", JSON.stringify(orderPayload));

    const { data: order, error: orderErr } = await admin
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .single();

    if (orderErr || !order?.id) {
        console.error("[createOrder] FALHA ao inserir order:", {
            code:    orderErr?.code,
            message: orderErr?.message,
            details: orderErr?.details,
            hint:    orderErr?.hint,
        });
        throw new Error(orderErr?.message ?? "Falha ao criar pedido");
    }

    console.log("[createOrder] Order criada | id:", order.id);

    const items = cart.map((item) => ({
        order_id:           order.id,
        product_variant_id: item.variantId,
        product_name:       item.name,
        quantity:           item.qty,
        qty:                item.qty,
        unit_price:         item.price,
        line_total:         item.price * item.qty,
    }));

    console.log("[createOrder] Inserindo order_items:", JSON.stringify(items));

    const { error: itemsErr } = await admin.from("order_items").insert(items);
    if (itemsErr) {
        console.error("[createOrder] FALHA ao inserir order_items:", {
            code:    itemsErr.code,
            message: itemsErr.message,
            details: itemsErr.details,
            hint:    itemsErr.hint,
        });
    } else {
        console.log("[createOrder] order_items inseridos com sucesso:", items.length);
    }

    return order.id as string;
}

// ─── Horário de funcionamento ─────────────────────────────────────────────────

function isWithinBusinessHours(settings: Record<string, unknown>): boolean {
    const bh = settings?.business_hours as Record<string, { open?: boolean; from?: string; to?: string }> | undefined;
    if (!bh) return true;

    const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const now      = new Date();
    const day      = bh[dayNames[now.getDay()]];

    if (!day?.open) return false;

    const [openH,  openM]  = (day.from ?? "08:00").split(":").map(Number);
    const [closeH, closeM] = (day.to   ?? "22:00").split(":").map(Number);
    const nowMin           = now.getHours() * 60 + now.getMinutes();

    return nowMin >= openH * 60 + openM && nowMin < closeH * 60 + closeM;
}

// ─── Envio ────────────────────────────────────────────────────────────────────

async function reply(phoneE164: string, text: string): Promise<void> {
    const result = await sendWhatsAppMessage(phoneE164, text);
    if (!result.ok) {
        console.error("[chatbot] Falha ao enviar resposta:", result.error);
    }
}

// ─── Ponto de entrada ─────────────────────────────────────────────────────────

export async function processInboundMessage(
    params: ProcessMessageParams
): Promise<void> {
    const { admin, companyId, threadId, phoneE164, text, profileName } = params;

    console.log("[chatbot] processInboundMessage START | thread:", threadId, "company:", companyId, "text:", text);

    const input = text.trim();
    if (!input) {
        console.log("[chatbot] input vazio, ignorando");
        return;
    }

    // Verifica se existe bot ativo para esta empresa
    const { data: botRows, error: botErr } = await admin
        .from("chatbots")
        .select("id")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1);

    console.log("[chatbot] chatbots ativos:", botRows?.length ?? 0, botErr ? `| erro: ${botErr.message}` : "");

    if (!botRows?.length) {
        console.warn("[chatbot] Nenhum chatbot ativo para company:", companyId, "— verifique tabela chatbots");
        return;
    }

    const [company, session] = await Promise.all([
        getCompanyInfo(admin, companyId),
        getOrCreateSession(admin, threadId, companyId),
    ]);

    const companyName = company?.name ?? "nossa loja";
    const settings    = company?.settings ?? {};

    console.log("[chatbot] session step:", session.step, "| cartItems:", session.cart.length, "| input:", input);

    // ── Comandos globais (funcionam em qualquer etapa) ────────────────────────

    if (matchesAny(input, ["cancelar", "reiniciar", "menu", "inicio", "comecar", "oi", "ola", "hello", "hi"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await reply(phoneE164, buildMainMenu(companyName));
        return;
    }

    if (matchesAny(input, ["atendente", "humano", "pessoa", "falar com alguem", "ajuda"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // ── Roteamento por etapa ─────────────────────────────────────────────────

    switch (session.step) {
        case "welcome":
        case "main_menu":
            await handleMainMenu(admin, companyId, threadId, phoneE164, companyName, settings, input, session, profileName);
            break;

        case "catalog_categories":
            await handleCatalogCategories(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "catalog_products":
            await handleCatalogProducts(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "cart":
            await handleCart(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "checkout_address":
            await handleCheckoutAddress(admin, companyId, threadId, phoneE164, input, session, profileName);
            break;

        case "checkout_payment":
            await handleCheckoutPayment(admin, companyId, threadId, phoneE164, input, session);
            break;

        case "checkout_confirm":
            await handleCheckoutConfirm(admin, companyId, threadId, phoneE164, companyName, input, session);
            break;

        case "handover":
            // Bot silenciado — humano está atendendo
            break;

        case "done":
            // Pedido já confirmado → volta ao menu no próximo contato
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await reply(phoneE164, buildMainMenu(companyName));
            break;

        default:
            await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
            await reply(phoneE164, buildMainMenu(companyName));
    }
}

// ─── WELCOME / MAIN MENU ──────────────────────────────────────────────────────

function buildMainMenu(companyName: string): string {
    return (
        `Olá! Bem-vindo(a) ao *${companyName}* 🍺\n\n` +
        `Como posso te ajudar?\n\n` +
        `1️⃣  Ver cardápio\n` +
        `2️⃣  Status do meu pedido\n` +
        `3️⃣  Falar com atendente\n\n` +
        `_Digite o número da opção._`
    );
}

async function handleMainMenu(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    settings: Record<string, unknown>,
    input: string,
    session: Session,
    profileName?: string | null
): Promise<void> {
    // Primeira mensagem → verifica horário e envia boas-vindas
    if (session.step === "welcome") {
        if (!isWithinBusinessHours(settings)) {
            const msg = (settings?.closed_message as string) ??
                "Olá! No momento estamos fechados. Volte em breve. 😊";
            await reply(phoneE164, msg);
            return;
        }
        await saveSession(admin, threadId, companyId, { step: "main_menu" });
        await reply(phoneE164, buildMainMenu(companyName));
        return;
    }

    // Opção 1: Ver cardápio
    if (input === "1" || matchesAny(input, ["cardapio", "produtos", "bebidas", "ver"])) {
        const categories = await getCategories(admin);

        if (!categories.length) {
            await reply(phoneE164, "Ops! Nenhuma categoria cadastrada ainda. Tente mais tarde. 😅");
            return;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "catalog_categories",
            context: { categories },
        });

        await sendListMessage(
            phoneE164,
            "🍺 Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    // Opção 2: Status do pedido
    if (input === "2" || matchesAny(input, ["status", "pedido", "onde", "acompanhar"])) {
        const customer = await getOrCreateCustomer(admin, phoneE164, profileName);

        if (!customer) {
            await reply(phoneE164, "Não encontrei cadastro para o seu número. 😅");
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
            await reply(phoneE164,
                "Você ainda não fez nenhum pedido por aqui. 😊\n" +
                "Digite *1* para ver o cardápio!"
            );
            return;
        }

        const statusLabels: Record<string, string> = {
            new:       "✅ Recebido",
            confirmed: "✅ Confirmado",
            preparing: "🔥 Em preparo",
            delivering:"🛵 Saiu para entrega",
            delivered: "📦 Entregue",
            finalized: "✅ Finalizado",
            canceled:  "❌ Cancelado",
        };

        const label = statusLabels[lastOrder.status] ?? lastOrder.status;
        const date  = new Date(lastOrder.created_at).toLocaleString("pt-BR");

        await reply(
            phoneE164,
            `*Seu último pedido:*\n\n` +
            `📋 Status: ${label}\n` +
            `💰 Total: ${formatCurrency(lastOrder.total_amount)}\n` +
            `📅 Data: ${date}\n\n` +
            `_Digite *1* para fazer um novo pedido._`
        );
        return;
    }

    // Opção 3: Falar com atendente
    if (input === "3" || matchesAny(input, ["atendente", "humano"])) {
        await doHandover(admin, companyId, threadId, phoneE164, companyName, session);
        return;
    }

    // Input inválido → repete menu
    await reply(phoneE164, buildMainMenu(companyName));
}

// ─── CATALOG_CATEGORIES ───────────────────────────────────────────────────────

async function handleCatalogCategories(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const categories = (session.context.categories as Category[]) ?? [];

    const num = parseInt(input, 10);
    let selected: Category | null = null;

    if (!isNaN(num) && num >= 1 && num <= categories.length) {
        selected = categories[num - 1];
    } else {
        const lower = normalize(input);
        selected = categories.find((c) => normalize(c.name).includes(lower)) ?? null;
    }

    if (!selected) {
        await sendListMessage(
            phoneE164,
            "Não entendi. Escolha uma categoria:",
            "Ver categorias",
            categories.map((c, i) => ({ id: String(i + 1), title: c.name })),
            "Categorias"
        );
        return;
    }

    const products = await getProductsByCategory(admin, selected.id);

    if (!products.length) {
        await reply(
            phoneE164,
            `Nenhum produto disponível em *${selected.name}* no momento.\n` +
            `Digite *menu* para voltar.`
        );
        return;
    }

    await saveSession(admin, threadId, companyId, {
        step:    "catalog_products",
        context: { ...session.context, products, category_name: selected.name },
    });

    await reply(phoneE164, buildProductsMessage(products, selected.name));
}

function buildProductsMessage(products: ProductOption[], title: string): string {
    const lines = [`*${title}* 🍺\n`];
    for (const p of products) {
        lines.push(`${p.idx}. ${p.name} — ${formatCurrency(p.price)}`);
    }
    lines.push(
        "\n_Digite o *número* do item para adicionar ao carrinho._\n" +
        "_Digite *carrinho* para ver o carrinho ou *menu* para voltar._"
    );
    return lines.join("\n");
}

// ─── CATALOG_PRODUCTS ─────────────────────────────────────────────────────────

async function handleCatalogProducts(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const products = (session.context.products as ProductOption[]) ?? [];

    // ── Botão "Mais produtos" ─────────────────────────────────────────────────
    if (matchesAny(input, ["mais produtos"])) {
        const catName = (session.context.category_name as string) ?? "Produtos";
        await reply(phoneE164, buildProductsMessage(products, catName));
        return;
    }

    // ── Se há produto pendente aguardando quantidade ──────────────────────────
    if (session.context.pending_product) {
        const qty = parseInt(input, 10);

        if (isNaN(qty) || qty < 1 || qty > 99) {
            await reply(phoneE164, "Digite uma quantidade válida (1 a 99).");
            return;
        }

        const pending = session.context.pending_product as ProductOption;
        const newCart = [...session.cart];
        const existingIdx = newCart.findIndex((i) => i.variantId === pending.variantId);

        if (existingIdx >= 0) {
            newCart[existingIdx] = { ...newCart[existingIdx], qty: newCart[existingIdx].qty + qty };
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
            cart:    newCart,
            context: { ...session.context, pending_product: null },
            // mantém step catalog_products para continuar comprando
        });

        await sendInteractiveButtons(
            phoneE164,
            `✅ *${qty}x ${pending.name}* adicionado!\n\n${formatCart(newCart)}`,
            [
                { id: "mais_produtos", title: "Mais produtos" },
                { id: "ver_carrinho",  title: "Ver carrinho" },
                { id: "finalizar",     title: "Finalizar pedido" },
            ]
        );
        return;
    }

    // ── Navegar para carrinho ou finalizar ────────────────────────────────────
    if (matchesAny(input, ["carrinho", "ver carrinho"])) {
        await goToCart(admin, companyId, threadId, phoneE164, session);
        return;
    }

    if (matchesAny(input, ["finalizar", "fechar", "checkout"])) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Escolha um produto primeiro.");
            return;
        }
        await goToCheckoutAddress(admin, companyId, threadId, phoneE164, session);
        return;
    }

    // ── Seleção de produto por número ─────────────────────────────────────────
    const num = parseInt(input, 10);
    if (isNaN(num) || num < 1 || num > products.length) {
        await reply(
            phoneE164,
            `Digite o *número* do produto para adicionar.\nOu *menu* para voltar ao início.`
        );
        return;
    }

    const selected = products[num - 1];

    await saveSession(admin, threadId, companyId, {
        context: { ...session.context, pending_product: selected },
    });

    await reply(
        phoneE164,
        `Ótima escolha! *${selected.name}* — ${formatCurrency(selected.price)}\n\n` +
        `Quantas unidades?`
    );
}

// ─── CART ─────────────────────────────────────────────────────────────────────

async function handleCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
): Promise<void> {
    if (matchesAny(input, ["finalizar", "fechar", "checkout", "confirmar"])) {
        if (!session.cart.length) {
            await reply(phoneE164, "Seu carrinho está vazio. Digite *1* para ver o cardápio.");
            return;
        }
        await goToCheckoutAddress(admin, companyId, threadId, phoneE164, session);
        return;
    }

    if (matchesAny(input, ["limpar", "esvaziar"])) {
        await saveSession(admin, threadId, companyId, { step: "main_menu", cart: [], context: {} });
        await reply(phoneE164, "Carrinho esvaziado.\n\n" + buildMainMenu(companyName));
        return;
    }

    // "remover 2", "tirar 1"
    const removeMatch = normalize(input).match(/^(remover|tirar|deletar)\s+(\d+)$/);
    if (removeMatch) {
        const idx = parseInt(removeMatch[2], 10) - 1;
        if (idx >= 0 && idx < session.cart.length) {
            const removed = session.cart[idx];
            const newCart = session.cart.filter((_, i) => i !== idx);
            await saveSession(admin, threadId, companyId, { cart: newCart });
            await reply(
                phoneE164,
                `🗑️ *${removed.name}* removido.\n\n${formatCart(newCart)}\n\n` +
                `_Digite *finalizar* para fechar o pedido ou *menu* para continuar comprando._`
            );
            return;
        }
    }

    await goToCart(admin, companyId, threadId, phoneE164, session);
}

async function goToCart(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    if (!session.cart.length) {
        await saveSession(admin, threadId, companyId, { step: "main_menu" });
        await reply(phoneE164, "Carrinho vazio. Digite *1* para ver o cardápio.");
        return;
    }

    await saveSession(admin, threadId, companyId, { step: "cart" });
    await reply(
        phoneE164,
        `🛒 *Seu carrinho:*\n\n${formatCart(session.cart)}\n\n` +
        `Digite *finalizar* para fechar o pedido\n` +
        `Digite *remover N* para tirar o item N\n` +
        `Digite *menu* para continuar comprando`
    );
}

// ─── CHECKOUT_ADDRESS ─────────────────────────────────────────────────────────

async function goToCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    session: Session
): Promise<void> {
    const customer   = await getOrCreateCustomer(admin, phoneE164);
    const customerId = customer?.id ?? null;
    const saved      = customer?.address ?? null;

    if (saved) {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: saved },
        });
        await reply(
            phoneE164,
            `📍 *Endereço de entrega cadastrado:*\n${saved}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
    } else {
        await saveSession(admin, threadId, companyId, {
            step:        "checkout_address",
            customer_id: customerId,
            context:     { ...session.context, saved_address: null, awaiting_address: true },
        });
        await reply(
            phoneE164,
            `📍 Qual é o seu *endereço de entrega*?\n\n` +
            `_Ex: Rua das Flores, 123, Bairro Centro_`
        );
    }
}

async function handleCheckoutAddress(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session,
    _profileName?: string | null
): Promise<void> {
    const savedAddress   = session.context.saved_address   as string | null;
    const awaitingAddress = session.context.awaiting_address as boolean | undefined;

    // Temos endereço salvo e aguardamos "1" ou "2"
    if (savedAddress && !awaitingAddress) {
        if (input === "1") {
            await saveSession(admin, threadId, companyId, {
                step:    "checkout_payment",
                context: { ...session.context, delivery_address: savedAddress },
            });
            await sendPaymentButtons(phoneE164);
            return;
        }
        if (input === "2") {
            await saveSession(admin, threadId, companyId, {
                context: { ...session.context, saved_address: null, awaiting_address: true },
            });
            await reply(phoneE164, `📍 Informe o novo endereço de entrega:\n\n_Ex: Rua das Flores, 123_`);
            return;
        }
        // Input inválido → repete a pergunta
        await reply(
            phoneE164,
            `📍 *Endereço cadastrado:*\n${savedAddress}\n\n` +
            `1️⃣  Usar este endereço\n` +
            `2️⃣  Informar novo endereço`
        );
        return;
    }

    // Aguardando digitação do endereço
    if (input.length < 10) {
        await reply(phoneE164, "Por favor, informe o endereço completo (rua, número e bairro).");
        return;
    }

    if (session.customer_id) {
        await admin.from("customers").update({ address: input }).eq("id", session.customer_id);
    }

    await saveSession(admin, threadId, companyId, {
        step:    "checkout_payment",
        context: {
            ...session.context,
            delivery_address: input,
            saved_address:    null,
            awaiting_address: false,
        },
    });

    await sendPaymentButtons(phoneE164);
}

// ─── CHECKOUT_PAYMENT ─────────────────────────────────────────────────────────

async function sendPaymentButtons(phoneE164: string): Promise<void> {
    await sendInteractiveButtons(
        phoneE164,
        "💳 Como deseja pagar?",
        [
            { id: "card", title: "Cartão" },
            { id: "pix",  title: "PIX" },
            { id: "cash", title: "Dinheiro" },
        ]
    );
}

async function sendOrderSummary(
    phoneE164: string,
    cart: CartItem[],
    address: string,
    paymentLabel: string,
    changeFor: number | null
): Promise<void> {
    const changeText = changeFor ? `\n💵 Troco: ${formatCurrency(changeFor)}` : "";
    await reply(
        phoneE164,
        `📋 *Resumo do pedido:*\n\n` +
        `${formatCart(cart)}\n\n` +
        `📍 Entrega: ${address}\n` +
        `💳 Pagamento: ${paymentLabel}${changeText}`
    );
    await sendInteractiveButtons(
        phoneE164,
        "Confirmar o pedido?",
        [
            { id: "confirmar", title: "Confirmar pedido" },
            { id: "cancelar",  title: "Cancelar" },
        ]
    );
}

async function handleCheckoutPayment(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    input: string,
    session: Session
): Promise<void> {
    const address = (session.context.delivery_address as string) ?? "—";

    // ── Sub-step: aguardando valor do troco ───────────────────────────────────
    if (session.context.awaiting_change_for) {
        let changeFor: number | null = null;

        if (!matchesAny(input, ["nao", "não", "n", "sem troco"])) {
            const parsed = parseFloat(input.replace(",", ".").replace(/[^0-9.]/g, ""));
            if (isNaN(parsed) || parsed <= 0) {
                await reply(phoneE164, "Digite o valor do troco (ex: *50*) ou *não* se não precisar.");
                return;
            }
            changeFor = parsed;
        }

        await saveSession(admin, threadId, companyId, {
            step:    "checkout_confirm",
            context: { ...session.context, change_for: changeFor, awaiting_change_for: false },
        });
        await sendOrderSummary(phoneE164, session.cart, address, "Dinheiro", changeFor);
        return;
    }

    // ── Seleção de forma de pagamento ─────────────────────────────────────────
    // Valores aceitos pelo DB: "pix" | "cash" | "card"
    const paymentMap: Record<string, string> = {
        "1":       "card",
        "2":       "pix",
        "3":       "cash",
        "cartao":  "card",
        "cartão":  "card",
        "card":    "card",
        "credito": "card",
        "debito":  "card",
        "pix":     "pix",
        "dinheiro":"cash",
        "cash":    "cash",
    };

    const method = paymentMap[normalize(input)];
    if (!method) {
        await sendPaymentButtons(phoneE164);
        return;
    }

    if (method === "cash") {
        await saveSession(admin, threadId, companyId, {
            context: { ...session.context, payment_method: "cash", awaiting_change_for: true },
        });
        await reply(phoneE164, "💵 Troco para quanto?\n\nDigite o valor (ex: *50*) ou *não* se não precisar de troco.");
        return;
    }

    // pix ou card → vai direto para confirmação
    const paymentLabel = method === "pix" ? "PIX" : "Cartão";
    await saveSession(admin, threadId, companyId, {
        step:    "checkout_confirm",
        context: { ...session.context, payment_method: method },
    });
    await sendOrderSummary(phoneE164, session.cart, address, paymentLabel, null);
}

// ─── CHECKOUT_CONFIRM ─────────────────────────────────────────────────────────

async function handleCheckoutConfirm(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    input: string,
    session: Session
): Promise<void> {
    const address       = (session.context.delivery_address as string) ?? "";
    const paymentMethod = (session.context.payment_method   as string) ?? "cash";
    const changeFor     = (session.context.change_for       as number | null) ?? null;

    console.log("[checkout_confirm] input:", input, "| customer_id:", session.customer_id,
        "| cart:", session.cart.length, "| address:", address,
        "| paymentMethod:", paymentMethod, "| changeFor:", changeFor);

    // Input não reconhecido → reenviar resumo SEM cancelar o pedido
    if (!matchesAny(input, ["confirmar", "confirmar pedido", "confirmo", "sim", "ok", "s", "1"])) {
        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const pmLabel = pmLabels[paymentMethod] ?? paymentMethod;
        await reply(phoneE164, "⚠️ Por favor, use os botões para confirmar ou cancelar o pedido:");
        await sendOrderSummary(phoneE164, session.cart, address, pmLabel, changeFor);
        return;
    }

    if (!session.customer_id) {
        console.error("[checkout_confirm] customer_id ausente na sessão | threadId:", threadId);
        await reply(phoneE164, "Houve um erro interno. Por favor, tente novamente. 😞");
        return;
    }

    try {
        const orderId    = await createOrder(admin, companyId, session.customer_id, session.cart, paymentMethod, address, changeFor);
        const orderShort = orderId.replace(/-/g, "").slice(-8).toUpperCase();

        console.log("[checkout_confirm] Pedido criado com sucesso | orderId:", orderId);

        // Snapshot do carrinho antes de limpar
        const cartSnapshot = [...session.cart];

        await saveSession(admin, threadId, companyId, {
            step:    "done",
            cart:    [],
            context: { last_order_id: orderId },
        });

        const pmLabels: Record<string, string> = { cash: "Dinheiro", pix: "PIX", card: "Cartão" };
        const paymentLine = paymentMethod === "cash"
            ? `💳 Pagamento: Dinheiro${changeFor ? ` (troco para ${formatCurrency(changeFor)})` : ""}`
            : `💳 Pagamento: ${pmLabels[paymentMethod] ?? paymentMethod}`;

        await reply(
            phoneE164,
            `✅ *Pedido confirmado!* 🍺\n\n` +
            `${formatCart(cartSnapshot)}\n\n` +
            `📍 Endereço: ${address}\n` +
            `${paymentLine}\n` +
            `🔖 Pedido: #${orderShort}\n\n` +
            `📦 Recebemos seu pedido e já estamos preparando!\n` +
            `_Obrigado por pedir no ${companyName}!_`
        );
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[checkout_confirm] ERRO ao criar pedido:", msg);
        await reply(
            phoneE164,
            `Desculpe, houve um erro ao registrar seu pedido. Por favor, fale com um atendente. 😞`
        );
    }
}

// ─── HANDOVER ─────────────────────────────────────────────────────────────────

async function doHandover(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string,
    companyName: string,
    session: Session
): Promise<void> {
    await Promise.all([
        admin
            .from("whatsapp_threads")
            .update({ bot_active: false, handover_at: new Date().toISOString() })
            .eq("id", threadId),

        saveSession(admin, threadId, companyId, { ...session, step: "handover" }),
    ]);

    await reply(
        phoneE164,
        `👋 Vou te conectar com um atendente do *${companyName}*.\n\n` +
        `_Aguarde, alguém responderá em breve._`
    );
}
