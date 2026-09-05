/** Tipos compartilhados — hub /plano e Configurações. */

export type BillingStatusJson = {
    ok?: boolean;
    error?: string;
    is_blocked?: boolean;
    /** Papel do caller na empresa (owner|admin — status é gated a esses). R3-7 UI. */
    role?: string;
    pagarme_subscription?: {
        plan: string;
        status: string;
        /** month | year (R2-3). Toggle de ciclo no /plano. */
        billing_period?: string | null;
        trial_ends_at: string | null;
        next_billing_at: string | null;
        last_paid_at: string | null;
        activated_at: string | null;
        pending_plan_key?: string | null;
        pending_plan_change_at?: string | null;
        pending_keep_user_ids?: string[] | null;
        pending_upgrade_plan_key?: string | null;
        pending_checkout_intent?: string | null;
        seat_quantity?: number | null;
    } | null;
    pending_invoice?: {
        pagarme_payment_url: string | null;
        pix_qr_code: string | null;
        amount: number;
        due_at: string;
        kind?: "subscription" | "year" | "seat_add" | "ai_pack" | "plan_upgrade" | "period_switch";
        target_plan_key?: string | null;
    } | null;
    /** Resultado do sync PSP sob demanda (rede de segurança se webhook falhou). */
    psp_sync?: {
        action: "fulfilled" | "pending" | "noop" | "error";
        kind?: "invoice";
        order_id?: string;
        error?: string;
        alreadyDone?: boolean;
    };
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
        is_default?: boolean;
    }>;
    default_card_id?: string | null;
    plan_key?: string | null;
    plan_label?: string | null;
    monthly_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
    };
    /** Preço anual à vista por plano (R2-3), canônico do banco. */
    yearly_prices_brl?: {
        essencial?: number;
        pro?: number;
        market?: number;
    };
    /** % canônico do anual (plans.yearly_discount_*). Mesma fonte do /signup. */
    yearly_savings_percent?: {
        essencial?: number;
        pro?: number;
        market?: number;
    };
    /** Valor canônico para exibir no checkout (RPC/planos; inclui anual). */
    checkout_amount_brl?: number | null;
    /** Valor da invoice pending, se houver. */
    obligation_amount_brl?: number | null;
    amount_mismatch?: boolean;
};

export type PlanBillingVariant = "full" | "pay";

export type RenthusCardForm = {
    number: string;
    exp: string;
    cvv: string;
    holder: string;
    /** CPF/CNPJ do titular do cartão (antifraude PSP) — não confundir com CNPJ da empresa. */
    holder_document: string;
};
export type RenthusBillingAddr = {
    cep: string;
    endereco: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
};
