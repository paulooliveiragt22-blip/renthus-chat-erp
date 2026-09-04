/**
 * Contratos canônicos de status de billing — Pagar.me.
 *
 * Fonte única de verdade para os enums de:
 *  - status de subscription (pagarme_subscriptions.status)
 *  - status de invoice (invoices.status)
 *  - plano (pagarme_subscriptions.plan / plans.key)
 *
 * Quando o Supabase gerar `Database["public"]["Enums"]`, este arquivo pode
 * passar a re-exportar de lá (single source of truth). Por ora, mantido como
 * literal types puros para evitar acoplamento ao gerador.
 *
 * Princípio: zero I/O, zero side-effects. Tudo neste arquivo é testável
 * sem banco nem framework.
 */

export const PAGARME_SUB_STATUSES = [
  "trial",
  "active",
  "overdue",
  "blocked",
  "cancelled",
  "pending_setup",
  "pending_payment",
  "abandoned",
] as const;

export type PagarmeSubStatus = (typeof PAGARME_SUB_STATUSES)[number];

export const PAGARME_INVOICE_STATUSES = [
  "pending",
  "paid",
  "failed",
  "cancelled",
] as const;

export type PagarmeInvoiceStatus = (typeof PAGARME_INVOICE_STATUSES)[number];

// -----------------------------------------------------------------------------
// Helpers de agrupamento — fonte única para "está pago?" / "precisa pagar?"
// -----------------------------------------------------------------------------

export const PAID_STATUSES = ["active"] as const satisfies readonly PagarmeSubStatus[];

export const NEEDS_PAYMENT_STATUSES = [
  "pending_payment",
  "pending_setup",
  "abandoned",
  "overdue",
] as const satisfies readonly PagarmeSubStatus[];

export const BLOCKING_STATUSES = [
  "blocked",
  "cancelled",
] as const satisfies readonly PagarmeSubStatus[];

export const TRIAL_STATUSES = ["trial"] as const satisfies readonly PagarmeSubStatus[];

export const NEVER_PAID_STATUSES = [
  "pending_payment",
  "pending_setup",
  "abandoned",
] as const satisfies readonly PagarmeSubStatus[];

function isOneOf<T extends string>(
  value: T,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** Subscription está plenamente paga e operacional? */
export function isPaid(status: PagarmeSubStatus): boolean {
  return isOneOf(status, PAID_STATUSES);
}

/** Subscription está em estado que bloqueia acesso do tenant? */
export function isBlocking(status: PagarmeSubStatus): boolean {
  return isOneOf(status, BLOCKING_STATUSES);
}

/** Subscription está em trial ativo (não vencido)? */
export function isActiveTrial(
  status: PagarmeSubStatus,
  trialEndsAt: string | Date | null,
  now: Date = new Date()
): boolean {
  if (status !== "trial") return false;
  if (!trialEndsAt) return false;
  const end = typeof trialEndsAt === "string" ? new Date(trialEndsAt) : trialEndsAt;
  return Number.isFinite(end.getTime()) && end > now;
}

/**
 * Subscription representa um tenant que NUNCA pagou.
 *
 * Considera nunca-pagou quando:
 *  - status é pending_payment / pending_setup / abandoned, OU
 *  - status é trial com trial vencido E last_paid_at null (trial grátis expirou sem conversão)
 */
export function isNeverPaid(
  row: {
    status: PagarmeSubStatus;
    last_paid_at: string | null | undefined;
    trial_ends_at: string | Date | null | undefined;
    now?: Date;
  }
): boolean {
  if (isOneOf(row.status, NEVER_PAID_STATUSES)) return true;
  if (
    row.status === "trial" &&
    row.last_paid_at == null &&
    row.trial_ends_at != null
  ) {
    const end =
      typeof row.trial_ends_at === "string"
        ? new Date(row.trial_ends_at)
        : row.trial_ends_at;
    const now = row.now ?? new Date();
    if (Number.isFinite(end.getTime()) && end <= now) return true;
  }
  return false;
}

/**
 * Garantia runtime: valida que um valor é um PagarmeSubStatus válido.
 * Útil para boundaries (parse de input externo / RPC).
 */
export function isPagarmeSubStatus(value: unknown): value is PagarmeSubStatus {
  return typeof value === "string" && isOneOf(value, PAGARME_SUB_STATUSES);
}

export function isPagarmeInvoiceStatus(value: unknown): value is PagarmeInvoiceStatus {
  return typeof value === "string" && isOneOf(value, PAGARME_INVOICE_STATUSES);
}

export function isSubscriptionPlanKey(value: unknown): value is SubscriptionPlanKey {
  return typeof value === "string" && isOneOf(value, SUBSCRIPTION_PLAN_KEYS);
}
export const SUBSCRIPTION_PLAN_KEYS = [
  "essencial",
  "pro",
  "market",
] as const;

export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLAN_KEYS)[number];
