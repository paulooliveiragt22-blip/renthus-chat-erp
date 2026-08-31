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
