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

export type PagarmeOrder = {
    id: string;
    status: string;
    charges?: PagarmeCharge[];
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

    if (params.phone) {
        const digits = params.phone.replace(/\D/g, "");
        if (digits.length >= 12) {
            body.phones = {
                mobile_phone: {
                    country_code: digits.slice(0, 2),
                    area_code: digits.slice(2, 4),
                    number: digits.slice(4),
                },
            };
        }
    }

    return pagarmeRequest<PagarmeCustomer>("/customers", "POST", body);
}

// ---------------------------------------------------------------------------
// Orders — Setup (cartão de crédito, parcelado)
// ---------------------------------------------------------------------------

export async function createSetupOrder(params: {
    amountCents: number;
    description: string;
    installments: number;
    cardToken: string;       // token gerado pelo Pagar.me.js no frontend
    customerId?: string;
    customer?: {
        name: string;
        email: string;
        document?: string;
        phone?: string;
    };
    metadata?: Record<string, string>;
}): Promise<PagarmeOrder> {
    const body: Record<string, unknown> = {
        items: [
            {
                amount: params.amountCents,
                description: params.description,
                quantity: 1,
                code: "setup",
            },
        ],
        payments: [
            {
                payment_method: "credit_card",
                credit_card: {
                    installments: params.installments,
                    card: { id: params.cardToken },
                    capture: true,
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
            cBody.document = c.document;
            cBody.document_type = c.document.length === 11 ? "CPF" : "CNPJ";
        }
        if (c.phone) {
            const digits = c.phone.replace(/\D/g, "");
            if (digits.length >= 12) {
                cBody.phones = {
                    mobile_phone: {
                        country_code: digits.slice(0, 2),
                        area_code: digits.slice(2, 4),
                        number: digits.slice(4),
                    },
                };
            }
        }
        body.customer = cBody;
    }

    return pagarmeRequest<PagarmeOrder>("/orders", "POST", body);
}

// ---------------------------------------------------------------------------
// Orders — Mensalidade (PIX)
// ---------------------------------------------------------------------------

export async function createPixInvoiceOrder(params: {
    amountCents: number;
    description: string;
    expiresInSeconds?: number; // padrão: 86400 (24h)
    customerId?: string;
    customer?: {
        name: string;
        email: string;
        document?: string;
        phone?: string;
    };
    metadata?: Record<string, string>;
}): Promise<PagarmeOrder> {
    const body: Record<string, unknown> = {
        items: [
            {
                amount: params.amountCents,
                description: params.description,
                quantity: 1,
                code: "mensalidade",
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
            cBody.document = c.document;
            cBody.document_type = c.document.length === 11 ? "CPF" : "CNPJ";
        }
        if (c.phone) {
            const digits = c.phone.replace(/\D/g, "");
            if (digits.length >= 12) {
                cBody.phones = {
                    mobile_phone: {
                        country_code: digits.slice(0, 2),
                        area_code: digits.slice(2, 4),
                        number: digits.slice(4),
                    },
                };
            }
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

export function centsToBRL(cents: number): number {
    return cents / 100;
}
