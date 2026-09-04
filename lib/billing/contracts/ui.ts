/**
 * Contrato de UI — Billing Platform
 *
 * Shapes canônicos que a UI do super admin consome. Derivam dos contratos
 * de domínio (subscription, invoice, plans) mas agregam dados prontos pra
 * render (empresa + plano + última fatura já incluídos).
 *
 * Re-exportado pela API (Route Handlers) e consumido pelas pages React.
 * Mantém paridade 1:1 com o que o use case `ListSubscriptionsForPlatform`
 * devolve (após adaptação no Route Handler).
 */

import type { PagarmeSubStatus, PagarmeInvoiceStatus, SubscriptionPlanKey } from "./status";

/** Empresa (forma reduzida para listas) */
export interface UiCompany {
    id: string;
    name: string;
    slug: string | null;
    is_active: boolean;
}

/** Plano (forma reduzida para listas) */
export interface UiPlan {
    id: string;
    key: SubscriptionPlanKey;
    name: string;
    price_cents: number;
}

/** Edição de lista no platform (R3-5) — anual via desconto, não centavos crus. */
export type UiYearlyDiscountMode = "percent" | "fixed_brl";

export interface UiPlanPricingAdmin {
    id: string;
    key: string;
    name: string;
    price_cents: number;
    yearly_discount_mode: UiYearlyDiscountMode;
    yearly_discount_value: number;
    /** Derivado: mensal×12 − desconto. */
    price_year_cents: number | null;
    included_seats: number | null;
    seat_extra_cents: number | null;
    description?: string | null;
}

/** Promo criada — kill-switch via `active` mesmo antes de ends_at. */
export interface UiPlanPromotionAdmin {
    id: string;
    plan_id: string;
    name: string;
    starts_at: string;
    ends_at: string;
    duration_months: number;
    adjustment_kind: "discount" | "surcharge";
    adjustment_mode: "percent" | "fixed_brl";
    adjustment_value: number;
    active: boolean;
    created_at?: string;
    plans?: { key?: string; name?: string } | null;
}

/** Payload criar/editar promo (platform → API). */
export type UiPlanPromotionUpsert = {
    plan_id: string;
    name?: string;
    starts_at: string;
    ends_at: string;
    duration_months: number;
    adjustment_kind: "discount" | "surcharge";
    adjustment_mode: "percent" | "fixed_brl";
    adjustment_value: number;
    active?: boolean;
};

/** PATCH parcial: só toggle OU campos de edição. */
export type UiPlanPromotionPatch =
    | { active: boolean }
    | (Partial<UiPlanPromotionUpsert> & { active?: boolean });

/** Última fatura conhecida (null se nunca teve) */
export interface UiLastInvoice {
    id: string;
    amount: number;
    status: PagarmeInvoiceStatus;
    due_at: string;
    paid_at: string | null;
}

/** Linha de subscription para a tabela do super admin. */
export interface UiSubscriptionRow {
    id: string;
    status: PagarmeSubStatus;
    plan_key: SubscriptionPlanKey | null;
    allow_overage: boolean;
    trial_ends_at: string | null;
    last_paid_at: string | null;
    next_billing_at: string | null;
    activated_at: string | null;
    started_at: string | null;
    company: UiCompany | null;
    plan: UiPlan | null;
    last_invoice: UiLastInvoice | null;
}

/** Tenant "never paid" — usado na tab "Sem pagamento" do super admin. */
export interface UiNeverPaidTenant {
    subscriptionId: string;
    companyId: string;
    companyName: string;
    email: string | null;
    cnpj: string | null;
    whatsappPhone: string | null;
    isActive: boolean;
    companyCreatedAt: string | null;
    plan: string;
    billingStatus: PagarmeSubStatus;
    trialEndsAt: string | null;
    pendingInvoice: {
        id: string;
        amount: number;
        dueAt: string;
        hasPix: boolean;
        pixQrCode: string | null;
        paymentUrl: string | null;
    } | null;
}
