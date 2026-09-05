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
    getYearlyPriceCentsForPlan,
    normalizePlanKey,
    type PlanInputKey,
} from "@/lib/billing/planCatalog";
import { isPixEmvPayload, isMundipaggPixStubUrl } from "@/lib/billing/pixEmv";
import { verifyPagarmeWebhookHmacSignature } from "@/lib/billing/pagarmeWebhookAuth";
import { classifyFiscalDocument } from "@/lib/billing/brazilianFiscalDocument";

export { isPixEmvPayload, isMundipaggPixStubUrl };

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
    const classified = classifyFiscalDocument(c.document);
    const cBody: Record<string, unknown> = {
        name:  c.name,
        email: c.email,
        type:  c.type ?? (classified.valid && classified.kind === "CPF" ? "individual" : "company"),
    };
    if (classified.valid) {
        cBody.document      = classified.digits;
        cBody.document_type = c.document_type ?? classified.kind;
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
            const holder = classifyFiscalDocument(params.holderDocument);
            if (holder.valid) {
                cardSub.holder_document = holder.digits;
            }
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
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: {
                Authorization: authHeader(),
                "Content-Type": "application/json",
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: ac.signal,
        });

        const json = (await res.json().catch(() => ({}))) as T;

        if (!res.ok) {
            const errObj = json as { message?: unknown };
            const msg =
                typeof errObj?.message === "string"
                    ? errObj.message
                    : `Pagar.me HTTP ${res.status}`;
            throw new Error(`[pagarme] ${msg} — ${JSON.stringify(json)}`);
        }

        return json;
    } finally {
        clearTimeout(timer);
    }
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
    metadata?: Record<string, string>;
};

export function extractOrderCustomerId(order: PagarmeOrder): string | null {
    const id = order?.customer?.id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** card_id Pagar.me a partir da charge (nunca PAN). */
export function extractCardIdFromOrder(order: PagarmeOrder): string | null {
    const tx = order.charges?.[0]?.last_transaction as
        | { card?: { id?: string }; card_id?: string }
        | undefined;
    const fromCard = tx?.card?.id?.trim();
    if (fromCard) return fromCard;
    const fromId = tx?.card_id?.trim();
    return fromId || null;
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
        const classified = classifyFiscalDocument(params.document);
        if (classified.valid) {
            body.document      = classified.digits;
            body.document_type = classified.kind;
            body.type          = classified.kind === "CPF" ? "individual" : "company";
        }
    }

    attachCustomerMobilePhone(body, params.phone);

    return pagarmeRequest<PagarmeCustomer>("/customers", "POST", body);
}

/** Atualiza documento do customer no PSP (corrige CNPJ inválido gravado no sandbox). */
export async function updatePagarmeCustomer(params: {
    customerId:     string;
    name?:          string;
    email?:         string;
    document:       string;
    document_type:  "CPF" | "CNPJ";
    type:           "individual" | "company";
    phone?:         string;
}): Promise<PagarmeCustomer> {
    const body: Record<string, unknown> = {
        document:      params.document.replaceAll(/\D/g, ""),
        document_type: params.document_type,
        type:          params.type,
    };
    if (params.name) body.name = params.name;
    if (params.email) body.email = params.email;
    attachCustomerMobilePhone(body, params.phone);
    return pagarmeRequest<PagarmeCustomer>(
        `/customers/${encodeURIComponent(params.customerId)}`,
        "PATCH",
        body
    );
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
                code:        params.itemCode ?? "mensalidade",
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

const TERMINAL_FAILED_STATUSES = new Set([
    "failed",
    "canceled",
    "cancelled",
    "not_authorized",
    "refused",
]);

/**
 * Order/charge em estado terminal de falha no PSP (L3).
 * Nunca true se já estiver paid — evita marcar local failed após race paid.
 */
export function isPagarmeOrderTerminalFailed(order: PagarmeOrder): boolean {
    if (isOrderCreditPaid(order)) return false;
    const orderSt = String(order.status ?? "").toLowerCase();
    if (TERMINAL_FAILED_STATUSES.has(orderSt)) return true;
    const chargeSt = String(order.charges?.[0]?.status ?? "").toLowerCase();
    return TERMINAL_FAILED_STATUSES.has(chargeSt);
}

/** Cobrança com cartão já salvo no cliente Pagar.me (`card_id`). */
export async function createOrderWithSavedCard(params: {
    amountCents: number;
    description: string;
    itemCode?: string;
    customerId: string;
    cardId: string;
    /** true para mensalidade / renovação (descriptor recorrente). */
    recurrence?: boolean;
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
                    recurrence: params.recurrence === true,
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

function pixTxFromCharge(charge: PagarmeCharge | undefined): PagarmePixTransaction | undefined {
    return charge?.last_transaction;
}

function extractPixCodeFromTx(tx: PagarmePixTransaction | undefined): string | null {
    if (!tx) return null;
    const candidates = [tx.qr_code, tx.qrCode];
    for (const raw of candidates) {
        if (typeof raw !== "string") continue;
        // Stub Mundipagg / URL — nunca tratar como EMV
        if (isMundipaggPixStubUrl(raw) || raw.startsWith("http")) continue;
        const normalized = raw.replace(/\s+/g, "").trim();
        if (isPixEmvPayload(normalized)) return normalized;
        if (isPixEmvPayload(raw.trim())) return raw.trim();
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

/** Cancela cobrança aberta (PIX waiting_payment / void). Best-effort — não propaga erro. */
export async function cancelPagarmeChargeBestEffort(orderId: string): Promise<void> {
    try {
        const order = await getPagarmeOrder(orderId);
        const chargeId = order.charges?.[0]?.id;
        if (!chargeId) return;
        const st = String(order.charges?.[0]?.status ?? "").toLowerCase();
        if (st === "paid" || st === "canceled" || st === "cancelled") return;
        await pagarmeRequest(`/charges/${encodeURIComponent(chargeId)}`, "DELETE");
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[pagarme] cancel charge best-effort:", orderId, msg);
    }
}

/**
 * Resolve QR + copia-e-cola conforme docs Pagar.me v5:
 * - `last_transaction.qr_code` = EMV (copia e cola) começando com 000201…
 * - `last_transaction.qr_code_url` = imagem do QR
 *
 * Contas com gateway legado às vezes devolvem `qr_code` = URL
 * `digital.mundipagg.com/pix/` (DNS morto) e a PNG só embute essa URL —
 * nesse caso não há EMV recuperável via API; é misconfig do meio PIX no painel.
 */
export async function resolvePixFromOrder(order: PagarmeOrder): Promise<{
    order: PagarmeOrder;
    pixCode: string | null;
    pixUrl: string | null;
    gatewayStub?: boolean;
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

    const rawQr = String(current.charges?.[0]?.last_transaction?.qr_code ?? "");
    const gatewayStub = isMundipaggPixStubUrl(rawQr);

    if (!pixCode) {
        // Preferir api.pagar.me (auth + PNG); ignorar stubs Mundipagg
        const urls: string[] = [];
        const tx = current.charges?.[0]?.last_transaction;
        for (const raw of [tx?.qr_code_url, tx?.qrCodeUrl, pixUrl, tx?.qr_code, tx?.qrCode, tx?.pdf]) {
            if (typeof raw !== "string" || !raw.startsWith("http")) continue;
            if (isMundipaggPixStubUrl(raw)) continue;
            if (!urls.includes(raw)) urls.push(raw);
        }
        // api.pagar.me primeiro
        urls.sort((a, b) => {
            const score = (u: string) => (u.includes("api.pagar.me") ? 0 : 1);
            return score(a) - score(b);
        });
        for (const url of urls) {
            const recovered = await recoverPixEmvFromUrl(url);
            if (recovered && isPixEmvPayload(recovered)) {
                pixCode = recovered;
                break;
            }
        }
    }

    if (!pixCode) {
        console.warn("[pagarme] PIX sem EMV (copia e cola). order=", current.id, {
            charge: current.charges?.[0]?.id,
            qr_code_sample: rawQr.slice(0, 80),
            qr_code_url: current.charges?.[0]?.last_transaction?.qr_code_url ?? null,
            gateway_stub: gatewayStub,
        });
    }

    return { order: current, pixCode, pixUrl, gatewayStub };
}

/**
 * Assinatura HMAC do webhook — legado / opcional (v3/v4).
 * L1 canônico do Core v5 = Basic Auth em `pagarmeWebhookAuth.ts`.
 *
 * Se secret e header presentes → timing-safe HMAC-SHA256.
 * Sem header ou sem secret → `true` (não bloqueia; Basic Auth já gated).
 */
export async function verifyWebhookSignature(
    rawBody: string,
    signature: string
): Promise<boolean> {
    const secret = process.env.PAGARME_WEBHOOK_SECRET?.trim();
    const sig = (signature ?? "").trim();
    if (!secret || !sig) return true;
    return verifyPagarmeWebhookHmacSignature(rawBody, signature, secret);
}

/** Order/charge considerado pago na API Pagar.me (fonte da verdade). */
export function isPagarmeOrderPaid(order: PagarmeOrder): boolean {
    return isOrderCreditPaid(order);
}

/**
 * Setup fee = 0 (BN-05). Env SETUP_PRICE_* legado ignorado.
 */
export function getSetupPriceCents(_plan?: PlanInputKey | string): number {
    void _plan;
    return 0;
}

/**
 * Mensalidade canônica = planCatalog / plans.price_cents (ADR-0004 B4).
 * Env MONTHLY_PRICE_* legado ignorado (causava Market cobrando R$ 297 via BOT).
 */
export function getMonthlyPriceCents(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (!key) return getMonthlyPriceCentsForPlan("essencial");
    return getMonthlyPriceCentsForPlan(key);
}

/** Anual canônico = planCatalog (−20% default; BN-04 / R2-B). */
export function getYearlyPriceCents(plan: PlanInputKey | string): number {
    const key = normalizePlanKey(plan);
    if (!key) return getYearlyPriceCentsForPlan("essencial");
    return getYearlyPriceCentsForPlan(key);
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
        const classified = classifyFiscalDocument(c.document);
        if (classified.valid) {
            cBody.document      = classified.digits;
            cBody.document_type = classified.kind;
            cBody.type          = classified.kind === "CPF" ? "individual" : "company";
        }
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
