/** Tipos compartilhados — hub /plano e Configurações. */

export type BillingStatusJson = {
    ok?: boolean;
    error?: string;
    is_blocked?: boolean;
    pagarme_subscription?: {
        plan: string;
        status: string;
        trial_ends_at: string | null;
        next_billing_at: string | null;
        last_paid_at: string | null;
        activated_at: string | null;
    } | null;
    pending_invoice?: {
        pagarme_payment_url: string | null;
        pix_qr_code: string | null;
        amount: number;
        due_at: string;
    } | null;
    pending_setup_payment?: {
        pagarme_payment_url: string | null;
        amount: number;
    } | null;
    invoice_history?: Array<{
        id: string;
        amount: number;
        status: string;
        due_at: string;
        paid_at: string | null;
        created_at: string;
    }>;
    saved_cards?: Array<{
        id: string;
        brand: string;
        last_four: string;
        holder: string;
        exp: string;
        status: string;
    }>;
    plan_key?: string | null;
    plan_label?: string | null;
    monthly_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
    };
    setup_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
    };
};

export type PlanBillingVariant = "full" | "pay";

export type RenthusCardForm = { number: string; exp: string; cvv: string; holder: string };
export type RenthusBillingAddr = {
    cep: string;
    endereco: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
};
