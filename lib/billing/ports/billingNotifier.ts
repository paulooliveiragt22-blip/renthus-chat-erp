/**
 * Port — BillingNotifier
 *
 * Define o contrato para notificações de billing (log estruturado + audit).
 *
 * Direção de dependência (Hexagonal):
 *   use-cases → ports ← adapters
 *
 * Implementações concretas:
 *   - ConsoleBillingNotifier (stdout + JSON) — produção
 *   - InMemoryBillingNotifier (testes)
 */

export type BillingEventKind =
  | "subscription_plan_changed"
  | "subscription_overage_changed"
  | "subscription_suspended"
  | "subscription_reactivated"
  | "company_suspended"
  | "company_reactivated"
  | "checkout_ensured"
  | "courtesy_trial_granted"
  | "subscription_status_changed"
  | "trial_expired"
  | "marked_abandoned";

export interface BillingEvent {
  kind: BillingEventKind;
  scope: string;
  message: string;
  companyId?: string;
  subscriptionId?: string;
  extra?: Record<string, unknown>;
  occurredAt: Date;
}

export interface BillingNotifierPort {
  /**
   * Publica evento de billing (chamado por use-cases após mutações).
   */
  publish(event: BillingEvent): Promise<void>;
}
