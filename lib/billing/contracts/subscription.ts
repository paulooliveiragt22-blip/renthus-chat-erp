/**
 * Contratos canônicos de subscription Pagar.me — shape usado em toda a app.
 *
 * Vem da tabela `pagarme_subscriptions` (já com colunas plan_id, plan_key,
 * allow_overage, started_at adicionadas na unificação).
 *
 * Princípio: tipos puros, sem dependência de Supabase Client ou RPC.
 */

import type { PagarmeSubStatus, SubscriptionPlanKey } from "./status";

/** Subscription Pagar.me — shape mínimo. */
export interface PagarmeSubscription {
  id: string;
  companyId: string;
  planKey: SubscriptionPlanKey | null;
  planId: string | null;
  status: PagarmeSubStatus;
  allowOverage: boolean;
  trialEndsAt: Date | null;
  lastPaidAt: Date | null;
  nextBillingAt: Date | null;
  activatedAt: Date | null;
  startedAt: Date | null;
}

/** Subscription + dados do company relacionado (para listas da UI do super admin). */
export interface PagarmeSubscriptionWithCompany extends PagarmeSubscription {
  companyName: string;
  companySlug: string | null;
  companyIsActive: boolean;
}

/** Subscription enriquecida com a última invoice conhecida (lista da UI). */
export interface PagarmeSubscriptionWithLastInvoice extends PagarmeSubscriptionWithCompany {
  lastInvoiceId: string | null;
  lastInvoiceAmount: number | null;
  lastInvoiceStatus: import("./status").PagarmeInvoiceStatus | null;
  lastInvoiceDueAt: Date | null;
  lastInvoicePaidAt: Date | null;
}
