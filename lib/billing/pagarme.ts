/**
 * lib/billing/pagarme.ts
 *
 * Cliente HTTP para a API Pagar.me v5.
 *
 * Variáveis de ambiente necessárias:
 *   PAGARME_API_KEY — chave secreta do Pagar.me (sk_live_xxx ou sk_test_xxx)
 */

import "server-only";

const BASE_URL = "https://api.pagar.me/core/v5";

/**
 * Pagar.me exige `customer.phones.mobile_phone`. Muitos usuários digitam só DDD+número (10–11 dígitos),
 * sem 55 — antes o payload omitia `phones` e a API retornava erro de campos obrigatórios.
 */
function normalizeBrazilPhoneDigits(raw: string): string {
    let d = raw.replace(/\D/g, "");
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

export type PagarmeCharge = {
    id: string;
    status: string;
    last_transaction?: {
        qr_code?: string;
        qr_code_url?: string;
        pdf?: string;
    };
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
};

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
    amountCents: number;
    description: string;
    installments: number;
    cardToken: string;       // token gerado pelo endpoint /tokens?appId=pk_xxx (browser)
    itemCode?: string;      // padrão "setup" — ex.: annual_bot
    customerId?: string;
    customer?: {
        name: string;
        email: string;
        document?: string;
        phone?: string;
        address?: {
            street:   string;
            number:   string;
            zipCode:  string;
            city:     string;
            state:    string;
            country?: string;
        };
    };
    /**
     * Com `card_token`, o Pagar.me ainda exige `card.billing_address` (não só `credit_card.billing_address`),
     * senão falha com validation_error | billing | "value" is required.
     * @see https://github.com/pagarme/pagarme-php/issues/408
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
    const creditCard: Record<string, unknown> = {
        installments:         params.installments,
        card_token:           params.cardToken,
        capture:              true,
        operation_type:       "auth_and_capture",
        statement_descriptor: "RENTHUS",
    };
    if (params.billingAddress) {
        const b = params.billingAddress;
        creditCard.card = {
            billing_address: {
                line_1:   b.line_1,
                line_2:   b.line_2 ?? "",
                zip_code: b.zip_code,
                city:     b.city,
                state:    b.state,
                country:  b.country ?? "BR",
            },
        };
    }

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
        const c = params.customer;
        const cBody: Record<string, unknown> = {
            name: c.name,
            email: c.email,
            type: "company",
        };
        if (c.document) {
            const digitsDoc = c.document.replace(/\D/g, "");
            cBody.document      = digitsDoc;
            cBody.document_type = digitsDoc.length === 11 ? "CPF" : "CNPJ";
        }
        attachCustomerMobilePhone(cBody, c.phone);
        if (c.address) {
            let zip = c.address.zipCode.replace(/\D/g, "");
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
        body.customer = cBody;
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

/** Cobrança de cartão aprovada na resposta síncrona do Pagar.me */
export function isOrderCreditPaid(order: PagarmeOrder): boolean {
    if (order.status === "paid") return true;
    const st = order.charges?.[0]?.status;
    return st === "paid";
}

// ---------------------------------------------------------------------------
// Orders — Mensalidade (PIX)
// ---------------------------------------------------------------------------

export async function createPixInvoiceOrder(params: {
    amountCents: number;
    description: string;
    /** items[0].code — padrão "mensalidade" */
    itemCode?: string;
    expiresInSeconds?: number; // padrão: 86400 (24h)
    customerId?: string;
    customer?: {
        name: string;
        email: string;
        document?: string;
        phone?: string;
        address?: {
            street:   string;
            number:   string;
            zipCode:  string;
            city:     string;
            state:    string;
            country?: string;
        };
    };
    metadata?: Record<string, string>;
}): Promise<PagarmeOrder> {
    const body: Record<string, unknown> = {
        items: [
            {
                amount: params.amountCents,
                description: params.description,
                quantity: 1,
                code: params.itemCode ?? "mensalidade",
            },
        ],
        payments: [
            {
                payment_method: "pix",
                pix: {
                    expires_in: params.expiresInSeconds ?? 86400 * 5, // 5 dias
                },
                amount: params.amountCents,
            },
        ],
        metadata: params.metadata ?? {},
    };

    if (params.customerId) {
        body.customer_id = params.customerId;
    } else if (params.customer) {
        const c = params.customer;
        const cBody: Record<string, unknown> = {
            name: c.name,
            email: c.email,
            type: "company",
        };
        if (c.document) {
            const digitsDoc = c.document.replace(/\D/g, "");
            cBody.document      = digitsDoc;
            cBody.document_type = digitsDoc.length === 11 ? "CPF" : "CNPJ";
        }
        attachCustomerMobilePhone(cBody, c.phone);
        if (c.address) {
            let zip = c.address.zipCode.replace(/\D/g, "");
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
        body.customer = cBody;
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extrai URL de pagamento PIX (QR code URL) do order do Pagar.me */
export function extractPixUrl(order: PagarmeOrder): string | null {
    const charge = order.charges?.[0];
    return (
        charge?.last_transaction?.qr_code_url ??
        charge?.last_transaction?.pdf ??
        null
    );
}

/** Extrai código PIX copia-e-cola */
export function extractPixCode(order: PagarmeOrder): string | null {
    return order.charges?.[0]?.last_transaction?.qr_code ?? null;
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

/** Preço em centavos para cada plano (configurável via env) */
export function getSetupPriceCents(plan: "bot" | "complete"): number {
    if (plan === "bot") {
        return parseInt(process.env.SETUP_PRICE_BOT_CENTS ?? "49700", 10);
    }
    return parseInt(process.env.SETUP_PRICE_COMPLETE_CENTS ?? "99700", 10);
}

export function getMonthlyPriceCents(plan: "bot" | "complete"): number {
    if (plan === "bot") {
        return parseInt(process.env.MONTHLY_PRICE_BOT_CENTS ?? "29700", 10);
    }
    return parseInt(process.env.MONTHLY_PRICE_COMPLETE_CENTS ?? "49700", 10);
}

/** Preço anual em centavos (taxa única paga upfront, setup incluso) */
export function getYearlyPriceCents(plan: "bot" | "complete"): number {
    if (plan === "bot") {
        // R$ 237/mês × 12 = R$ 2.844,00
        return parseInt(process.env.YEARLY_PRICE_BOT_CENTS ?? "284400", 10);
    }
    // R$ 317/mês × 12 = R$ 3.804,00
    return parseInt(process.env.YEARLY_PRICE_COMPLETE_CENTS ?? "380400", 10);
}

export function centsToBRL(cents: number): number {
    return cents / 100;
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
        const c = params.customer;
        const cBody: Record<string, unknown> = {
            name:  c.name,
            email: c.email,
            type:  "company",
        };
        if (c.document) {
            const digitsDoc = c.document.replace(/\D/g, "");
            cBody.document      = digitsDoc;
            cBody.document_type = digitsDoc.length === 11 ? "CPF" : "CNPJ";
        }
        attachCustomerMobilePhone(cBody, c.phone);
        if (c.address) {
            let zip = c.address.zipCode.replace(/\D/g, "");
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
        body.customer = cBody;
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

/** Extrai a URL do checkout hosted (página hospedada pelo Pagar.me) */
export function extractCheckoutUrl(order: PagarmeOrder): string | null {
    return order.checkouts?.[0]?.payment_url ?? null;
}
