/**
 * lib/billing/pagarme.ts
 *
 * Cliente HTTP para a API Pagar.me v5.
 *
 * Variáveis de ambiente necessárias:
 *   PAGARME_API_KEY — chave secreta do Pagar.me (sk_live_xxx ou sk_test_xxx)
 */

import "server-only";
import {
    getMonthlyPriceCentsForPlan,
    normalizePlanKey,
    type PlanInputKey,
} from "@/lib/billing/planCatalog";

const BASE_URL = "https://api.pagar.me/core/v5";

/**
 * Pagar.me exige `customer.phones.mobile_phone`. Muitos usuários digitam só DDD+número (10–11 dígitos),
 * sem 55 — antes o payload omitia `phones` e a API retornava erro de campos obrigatórios.
 */
function normalizeBrazilPhoneDigits(raw: string): string {
    let d = raw.replaceAll(/\D/g, "");
    if (!d) return "";
    if (d.startsWith("55") && d.length >= 12) return d;
    while (d.startsWith("0") && d.length > 10) d = d.slice(1);
    if (!d.startsWith("55") && d.length >= 10 && d.length <= 11) return `55${d}`;
    return d;
}

/** Monta `phones.mobile_phone` (DDI 55 + DDD + número). */
function pagarmeMobilePhoneBlock(digits: string): { mobile_phone: { country_code: string; area_code: string; number: string } } | null {
    if (digits.length < 12 || !digits.startsWith("55")) return null;
    const areaCode = digits.slice(2, 4);
    const number   = digits.slice(4);
    if (!/^\d{2}$/.test(areaCode) || number.length < 8 || number.length > 9) return null;
    return {
        mobile_phone: {
            country_code: "55",
            area_code:    areaCode,
            number,
        },
    };
}

function attachCustomerMobilePhone(cBody: Record<string, unknown>, phoneRaw: string | undefined): void {
    if (!phoneRaw?.trim()) return;
    const block = pagarmeMobilePhoneBlock(normalizeBrazilPhoneDigits(phoneRaw));
    if (block) cBody.phones = block;
}

/** Cliente em payload de order (cartão/PIX) — endereço em `address` (não `addresses`). */
type OrderCustomerPayload = {
    name:           string;
    email:          string;
    type?:          "individual" | "company";
    document?:      string;
    document_type?: "CPF" | "CNPJ";
    phone?:         string;
    address?: {
        street:        string;
        number:        string;
        neighborhood?: string;
        zipCode:       string;
        city:          string;
        state:         string;
        country?:      string;
    };
};

function buildOrderCustomerBody(c: OrderCustomerPayload): Record<string, unknown> {
    const docRaw = c.document?.replaceAll(/\D/g, "") ?? "";
    const isCpf  = docRaw.length === 11;
    const cBody: Record<string, unknown> = {
        name:  c.name,
        email: c.email,
        type:  c.type ?? (isCpf ? "individual" : "company"),
    };
    if (docRaw) {
        cBody.document      = docRaw;
        cBody.document_type = c.document_type ?? (isCpf ? "CPF" : "CNPJ");
    }
    attachCustomerMobilePhone(cBody, c.phone);
    if (c.address) {
        let zip = c.address.zipCode.replaceAll(/\D/g, "");
        if (zip.length > 0 && zip.length < 8) zip = zip.padStart(8, "0");
        const line1Parts = [c.address.street, c.address.number, c.address.neighborhood]
            .map((s) => s?.trim())
            .filter(Boolean);
        cBody.address = {
            line_1:   line1Parts.join(", "),
            zip_code: zip,
            city:     c.address.city,
            state:    c.address.state,
            country:  c.address.country ?? "BR",
        };
    }
    return cBody;
}

function buildSetupCreditCardPayment(params: {
    installments:   number;
    cardToken:      string;
    holderDocument?: string;
    billingAddress?: {
        line_1:   string;
        line_2?:  string;
        zip_code: string;
        city:     string;
        state:    string;
        country?: string;
    };
}): Record<string, unknown> {
    const creditCard: Record<string, unknown> = {
        installments:         params.installments,
        card_token:           params.cardToken,
        operation_type:       "auth_and_capture",
        statement_descriptor: "RENTHUS",
    };
    if (params.billingAddress) {
        const b       = params.billingAddress;
        const cardSub: Record<string, unknown> = {
            billing_address: {
                line_1:   b.line_1,
                line_2:   b.line_2 ?? "",
                zip_code: b.zip_code,
                city:     b.city,
                state:    b.state,
                country:  b.country ?? "BR",
            },
        };
        if (params.holderDocument) {
            cardSub.holder_document = params.holderDocument.replaceAll(/\D/g, "");
        }
        creditCard.card = cardSub;
    }
    return creditCard;
}

function authHeader(): string {
    const key = process.env.PAGARME_API_KEY;
    if (!key) throw new Error("PAGARME_API_KEY não configurada");
    return "Basic " + Buffer.from(key + ":").toString("base64");
}

async function pagarmeRequest<T = unknown>(
    path: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    body?: object
): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            Authorization: authHeader(),
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json().catch(() => ({}))) as T;

    if (!res.ok) {
        const msg = (json as any)?.message ?? `Pagar.me HTTP ${res.status}`;
        throw new Error(`[pagarme] ${msg} — ${JSON.stringify(json)}`);
    }

    return json;
}

// ---------------------------------------------------------------------------
// Tipos mínimos do Pagar.me v5
// ---------------------------------------------------------------------------

export type PagarmeCustomer = {
    id: string;
    name: string;
    email: string;
};

export type PagarmePixTransaction = {
    qr_code?: string;
    qr_code_url?: string;
    pdf?: string;
    /** Algumas respostas usam camelCase alternativo */
    qrCode?: string;
    qrCodeUrl?: string;
};

export type PagarmeCharge = {
    id: string;
    status: string;
    last_transaction?: PagarmePixTransaction;
};

export type PagarmeCheckout = {
    id: string;
    status: string;
    payment_url: string;
};

export type PagarmeOrder = {
    id: string;
    status: string;
    charges?: PagarmeCharge[];
    checkouts?: PagarmeCheckout[];
    customer?: { id?: string };
};

export function extractOrderCustomerId(order: PagarmeOrder): string | null {
    const id = order?.customer?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function createCustomer(params: {
    name: string;
    email: string;
    document?: string; // CPF/CNPJ sem formatação
    phone?: string;    // Ex: "5566992285005"
}): Promise<PagarmeCustomer> {
    const body: Record<string, unknown> = {
        name: params.name,
        email: params.email,
        type: "company",
    };

    if (params.document) {
        body.document = params.document;
        body.document_type = params.document.length === 11 ? "CPF" : "CNPJ";
    }

    attachCustomerMobilePhone(body, params.phone);

    return pagarmeRequest<PagarmeCustomer>("/customers", "POST", body);
}

// ---------------------------------------------------------------------------
// Orders — Setup (cartão de crédito, parcelado)
// ---------------------------------------------------------------------------

export async function createSetupOrder(params: {
    amountCents:    number;
    description:    string;
    installments:   number;
    cardToken:      string;
    itemCode?:      string;
    holderDocument?: string;  // CPF/CNPJ do titular — enviado em card.holder_document
    customerId?:    string;
    customer?: {
        name:           string;
        email:          string;
        type?:          "individual" | "company";
        document?:      string;
        document_type?: "CPF" | "CNPJ";
        phone?:         string;
        address?: {
            street:        string;
            number:        string;
            neighborhood?: string;
            zipCode:       string;
            city:          string;
            state:         string;
            country?:      string;
        };
    };
    /**
     * Com `card_token`, o Pagar.me ainda exige `card.billing_address`
     * (não só `credit_card.billing_address`), senão falha com
     * validation_error | billing | "value" is required.
     */
    billingAddress?: {
        line_1:   string;
        line_2?:  string;
        zip_code: string;
        city:     string;
        state:    string;
        country?: string;
    };
    metadata?: Record<string, string>;
}): Promise<PagarmeOrder> {
    const creditCard = buildSetupCreditCardPayment({
        installments:   params.installments,
        cardToken:      params.cardToken,
        holderDocument: params.holderDocument,
        billingAddress: params.billingAddress,
    });

    const body: Record<string, unknown> = {
        items: [
            {
                amount:      params.amountCents,
                description: params.description,
                quantity:    1,
                code:        params.itemCode ?? "setup",
            },
        ],
        payments: [
            {
                payment_method: "credit_card",
                credit_card:    creditCard,
                amount:         params.amountCents,
            },
        ],
        metadata: params.metadata ?? {},
    };

    if (params.customerId) {
        body.customer_id = params.customerId;
    } else if (params.customer) {
        body.customer = buildOrderCustomerBody(params.customer);
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

/** Cobrança de cartão aprovada na resposta síncrona do Pagar.me */
export function isOrderCreditPaid(order: PagarmeOrder): boolean {
    if (order.status === "paid") return true;
    const st = order.charges?.[0]?.status;
    return st === "paid";
}

/** Cobrança com cartão já salvo no cliente Pagar.me (`card_id`). */
export async function createOrderWithSavedCard(params: {
    amountCents: number;
    description: string;
    itemCode?: string;
    customerId: string;
    cardId: string;
    metadata?: Record<string, string>;
}): Promise<PagarmeOrder> {
    const body: Record<string, unknown> = {
        customer_id: params.customerId,
        items: [
            {
                amount: params.amountCents,
                description: params.description,
                quantity: 1,
                code: params.itemCode ?? "ai_pack",
            },
        ],
        payments: [
            {
                payment_method: "credit_card",
                amount: params.amountCents,
                credit_card: {
                    card_id: params.cardId,
                    recurrence: false,
                    installments: 1,
                    statement_descriptor: "RENTHUS",
                    capture: true,
                },
            },
        ],
        metadata: params.metadata ?? {},
    };
    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

// ---------------------------------------------------------------------------
// Orders — Mensalidade (PIX)
// ---------------------------------------------------------------------------

export async function createPixInvoiceOrder(params: {
    amountCents:       number;
    description:       string;
    itemCode?:         string;
    expiresInSeconds?: number;
    customerId?:       string;
    customer?: {
        name:           string;
        email:          string;
        type?:          "individual" | "company";
        document?:      string;
        document_type?: "CPF" | "CNPJ";
        phone?:         string;
        address?: {
            street:        string;
            number:        string;
            neighborhood?: string;
            zipCode:       string;
            city:          string;
            state:         string;
            country?:      string;
        };
    };
    additionalInfo?: Array<{ name: string; value: string }>;
    metadata?:       Record<string, string>;
}): Promise<PagarmeOrder> {
    const pix: Record<string, unknown> = {
        expires_in: params.expiresInSeconds ?? 86400 * 30, // 30 dias padrão
    };
    if (params.additionalInfo?.length) {
        pix.additional_information = params.additionalInfo;
    }

    const body: Record<string, unknown> = {
        items: [
            {
                amount:      params.amountCents,
                description: params.description,
                quantity:    1,
                code:        params.itemCode ?? "mensalidade",
            },
        ],
        payments: [
            {
                payment_method: "pix",
                pix,
                amount: params.amountCents,
            },
        ],
        metadata: params.metadata ?? {},
    };

    if (params.customerId) {
        body.customer_id = params.customerId;
    } else if (params.customer) {
        body.customer = buildOrderCustomerBody(params.customer);
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** EMV PIX (copia-e-cola) vs URL de QR/página Mundipagg. */
export function isPixEmvPayload(raw: string): boolean {
    const s = raw.trim();
    if (!s || s.startsWith("http://") || s.startsWith("https://")) return false;
    // Docs Pagar.me: BR Code começa com 000201…
    if (s.startsWith("000201")) return true;
    // Fallback: string longa sem URL
    return s.length >= 40 && !s.includes("://");
}

function pixTxFromCharge(charge: PagarmeCharge | undefined): PagarmePixTransaction | undefined {
    return charge?.last_transaction;
}

function extractPixCodeFromTx(tx: PagarmePixTransaction | undefined): string | null {
    if (!tx) return null;
    const candidates = [tx.qr_code, tx.qrCode];
    for (const raw of candidates) {
        if (typeof raw === "string" && isPixEmvPayload(raw)) return raw.trim();
    }
    return null;
}

function extractPixUrlFromTx(tx: PagarmePixTransaction | undefined): string | null {
    if (!tx) return null;
    for (const raw of [tx.qr_code_url, tx.qrCodeUrl, tx.pdf]) {
        if (typeof raw === "string" && raw.startsWith("http")) return raw;
    }
    // Mundipagg às vezes coloca a URL da página em `qr_code` (não é o EMV).
    for (const raw of [tx.qr_code, tx.qrCode]) {
        if (typeof raw === "string" && raw.startsWith("http")) return raw.trim();
    }
    return null;
}

/** Busca profunda por string EMV `000201…` no JSON da cobrança/pedido. */
function findEmvInUnknown(node: unknown, depth = 0): string | null {
    if (depth > 6 || node == null) return null;
    if (typeof node === "string") {
        return isPixEmvPayload(node) ? node.trim() : null;
    }
    if (Array.isArray(node)) {
        for (const item of node) {
            const hit = findEmvInUnknown(item, depth + 1);
            if (hit) return hit;
        }
        return null;
    }
    if (typeof node === "object") {
        for (const v of Object.values(node as Record<string, unknown>)) {
            const hit = findEmvInUnknown(v, depth + 1);
            if (hit) return hit;
        }
    }
    return null;
}

/** Extrai URL de pagamento PIX (imagem QR ou página) do order do Pagar.me */
export function extractPixUrl(order: PagarmeOrder): string | null {
    return extractPixUrlFromTx(pixTxFromCharge(order.charges?.[0]));
}

/** Extrai código PIX copia-e-cola (EMV). Ignora URLs. */
export function extractPixCode(order: PagarmeOrder): string | null {
    const fromTx = extractPixCodeFromTx(pixTxFromCharge(order.charges?.[0]));
    if (fromTx) return fromTx;
    return findEmvInUnknown(order.charges?.[0] ?? order);
}

export async function getPagarmeOrder(orderId: string): Promise<PagarmeOrder> {
    return pagarmeRequest<PagarmeOrder>(`/orders/${encodeURIComponent(orderId)}`, "GET");
}

export async function getPagarmeCharge(chargeId: string): Promise<PagarmeCharge> {
    return pagarmeRequest<PagarmeCharge>(`/charges/${encodeURIComponent(chargeId)}`, "GET");
}

/**
 * Resolve QR + copia-e-cola conforme docs Pagar.me v5:
 * - `last_transaction.qr_code` = EMV (copia e cola)
 * - `last_transaction.qr_code_url` = imagem do QR
 * Se o create só devolver URL Mundipagg, refetch GET /orders/{id} e GET /charges/{id}.
 * Fallback: decodifica o QR da imagem/página (Mundipagg às vezes omite o EMV no JSON).
 */
export async function resolvePixFromOrder(order: PagarmeOrder): Promise<{
    order: PagarmeOrder;
    pixCode: string | null;
    pixUrl: string | null;
}> {
    const { recoverPixEmvFromUrl } = await import("@/lib/billing/decodePixQrFromUrl");

    let current = order;
    let pixCode = extractPixCode(current);
    let pixUrl = extractPixUrl(current);

    if (!pixCode && current.id) {
        try {
            current = await getPagarmeOrder(current.id);
            pixCode = extractPixCode(current) ?? pixCode;
            pixUrl = extractPixUrl(current) ?? pixUrl;
        } catch (e) {
            console.warn("[pagarme] get order for PIX EMV failed:", e);
        }
    }

    const chargeId = current.charges?.[0]?.id;
    if (!pixCode && chargeId) {
        try {
            const charge = await getPagarmeCharge(chargeId);
            pixCode = extractPixCodeFromTx(charge.last_transaction) ?? findEmvInUnknown(charge);
            pixUrl = extractPixUrlFromTx(charge.last_transaction) ?? pixUrl;
            if (pixCode || charge.last_transaction) {
                current = {
                    ...current,
                    charges: [
                        {
                            ...(current.charges?.[0] ?? { id: chargeId, status: charge.status }),
                            ...charge,
                            last_transaction: charge.last_transaction,
                        },
                    ],
                };
            }
        } catch (e) {
            console.warn("[pagarme] get charge for PIX EMV failed:", e);
        }
    }

    if (!pixCode) {
        const urls = new Set<string>();
        if (pixUrl) urls.add(pixUrl);
        const tx = current.charges?.[0]?.last_transaction;
        for (const raw of [tx?.qr_code_url, tx?.qrCodeUrl, tx?.qr_code, tx?.qrCode, tx?.pdf]) {
            if (typeof raw === "string" && raw.startsWith("http")) urls.add(raw);
        }
        for (const url of urls) {
            const recovered = await recoverPixEmvFromUrl(url);
            if (recovered) {
                pixCode = recovered;
                break;
            }
        }
    }

    if (!pixCode) {
        console.warn("[pagarme] PIX sem EMV (copia e cola). order=", current.id, {
            charge: current.charges?.[0]?.id,
            qr_code_sample: String(current.charges?.[0]?.last_transaction?.qr_code ?? "").slice(0, 80),
            qr_code_url: current.charges?.[0]?.last_transaction?.qr_code_url ?? null,
        });
    }

    return { order: current, pixCode, pixUrl };
}

/** Verifica assinatura HMAC-SHA256 do webhook do Pagar.me */
export async function verifyWebhookSignature(
    rawBody: string,
    signature: string
): Promise<boolean> {
    const secret = process.env.PAGARME_WEBHOOK_SECRET;
    if (!secret) return true; // sem segredo configurado: ignora verificação (dev)

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(rawBody)
    );
    const computed = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    return computed === signature;
}

/** Preço em centavos para cada plano (configurável via env nos legados) */
export function getSetupPriceCents(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (key === "essencial") {
        return parseInt(process.env.SETUP_PRICE_ESSENCIAL_CENTS ?? process.env.SETUP_PRICE_BOT_CENTS ?? "0", 10);
    }
    if (key === "market") {
        return parseInt(process.env.SETUP_PRICE_MARKET_CENTS ?? "0", 10);
    }
    return parseInt(
        process.env.SETUP_PRICE_PRO_CENTS ?? process.env.SETUP_PRICE_COMPLETE_CENTS ?? "0",
        10
    );
}

export function getMonthlyPriceCents(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (!key) return getMonthlyPriceCentsForPlan("essencial");
    const fromEnv =
        key === "essencial"
            ? process.env.MONTHLY_PRICE_ESSENCIAL_CENTS ?? process.env.MONTHLY_PRICE_BOT_CENTS
            : key === "market"
              ? process.env.MONTHLY_PRICE_MARKET_CENTS
              : process.env.MONTHLY_PRICE_PRO_CENTS ?? process.env.MONTHLY_PRICE_COMPLETE_CENTS;
    if (fromEnv && /^\d+$/.test(fromEnv)) return parseInt(fromEnv, 10);
    return getMonthlyPriceCentsForPlan(key);
}

/** Preço anual em centavos (10× mensal = 2 meses off) */
export function getYearlyPriceCents(plan: PlanInputKey | string): number {
    return getMonthlyPriceCents(plan) * 10;
}

export function centsToBRL(cents: number): number {
    return cents / 100;
}

/** Resumo de cartão retornado pelo Pagar.me (GET /customers/{id}/cards). */
export type PagarmeCardSummary = {
    id?:               string;
    last_four_digits?: string;
    first_six_digits?: string;
    brand?:            string;
    holder_name?:      string;
    exp_month?:        number;
    exp_year?:         number;
    status?:           string;
};

export async function listCustomerCards(customerId: string): Promise<PagarmeCardSummary[]> {
    const id = customerId?.trim();
    if (!id) return [];
    try {
        const res = await pagarmeRequest<{ data?: PagarmeCardSummary[] }>(
            `/customers/${encodeURIComponent(id)}/cards`,
            "GET"
        );
        return Array.isArray(res?.data) ? res.data : [];
    } catch (e) {
        console.warn("[pagarme] listCustomerCards:", e instanceof Error ? e.message : e);
        return [];
    }
}

function buildCheckoutHostedCustomer(c: {
    name:     string;
    email:    string;
    document?: string;
    phone?:   string;
    address?: {
        street:   string;
        number:   string;
        zipCode:  string;
        city:     string;
        state:    string;
        country?: string;
    };
}): Record<string, unknown> {
    const cBody: Record<string, unknown> = {
        name:  c.name,
        email: c.email,
        type:  "company",
    };
    if (c.document) {
        const digitsDoc = c.document.replaceAll(/\D/g, "");
        cBody.document      = digitsDoc;
        cBody.document_type = digitsDoc.length === 11 ? "CPF" : "CNPJ";
    }
    attachCustomerMobilePhone(cBody, c.phone);
    if (c.address) {
        let zip = c.address.zipCode.replaceAll(/\D/g, "");
        if (zip.length > 0 && zip.length < 8) zip = zip.padStart(8, "0");
        const line1 = `${c.address.street} ${c.address.number}`.trim();
        cBody.addresses = [
            {
                line_1:   line1,
                zip_code: zip,
                city:     c.address.city,
                state:    c.address.state,
                country:  c.address.country ?? "BR",
            },
        ];
    }
    return cBody;
}

// ---------------------------------------------------------------------------
// Orders — Checkout Hosted (cartão + PIX, abre página hospedada do Pagar.me)
// ---------------------------------------------------------------------------

export async function createCheckoutOrder(params: {
    amountCents:     number;
    description:     string;
    code:            string;       // ex: "setup_bot", "mensalidade"
    maxInstallments: number;       // 1–10 (opções disponíveis no checkout)
    acceptPix?:      boolean;      // padrão true
    acceptCard?:     boolean;      // padrão true
    customerId?:     string;
    customer?: {
        name:      string;
        email:     string;
        document?: string;
        phone?:    string;
        address?: {
            street:   string;
            number:   string;
            zipCode:  string;
            city:     string;
            state:    string;
            country?: string;
        };
    };
    successUrl:  string;
    cancelUrl?:  string;
    metadata?:   Record<string, string>;
}): Promise<PagarmeOrder> {
    const acceptedMethods: string[] = [];
    if (params.acceptCard !== false) acceptedMethods.push("credit_card");
    if (params.acceptPix  !== false) acceptedMethods.push("pix");
    if (acceptedMethods.length === 0) acceptedMethods.push("credit_card", "pix"); // fallback

    // Gera opções de parcelamento (1x até maxInstallments)
    const installments = Array.from({ length: params.maxInstallments }, (_, i) => ({
        number: i + 1,
        total:  params.amountCents,
    }));

    const checkoutPayment: Record<string, unknown> = {
        payment_method: "checkout",
        checkout: {
            expires_in:               120,   // minutos
            billing_address_editable: false,
            customer_editable:        false,
            accepted_payment_methods: acceptedMethods,
            success_url:              params.successUrl,
            cancel_url:               params.cancelUrl ?? params.successUrl,
            credit_card: {
                capture:              true,
                statement_descriptor: "RENTHUS",
                installments,
            },
            ...(params.acceptPix !== false && {
                pix: { expires_in: 86400 * 5 }, // 5 dias
            }),
        },
    };

    const body: Record<string, unknown> = {
        items: [{
            amount:      params.amountCents,
            description: params.description,
            quantity:    1,
            code:        params.code,
        }],
        payments: [checkoutPayment],
        metadata: params.metadata ?? {},
    };

    if (params.customerId) {
        body.customer_id = params.customerId;
    } else if (params.customer) {
        body.customer = buildCheckoutHostedCustomer(params.customer);
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

/** Extrai a URL do checkout hosted (página hospedada pelo Pagar.me) */
export function extractCheckoutUrl(order: PagarmeOrder): string | null {
    return order.checkouts?.[0]?.payment_url ?? null;
}
