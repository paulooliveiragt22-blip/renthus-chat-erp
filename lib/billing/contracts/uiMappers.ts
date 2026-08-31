/**
 * Mappers — converte shape canônico de domínio (do use case) para shape
 * de UI (que a página React consome).
 *
 * Mantém a separação: domain (UI-independente) vs UI (pronto pra render).
 */

import type { PagarmeSubscriptionWithLastInvoice, WithSupabaseEmbeds } from "./subscription";
import type { UiSubscriptionRow, UiPlan, UiCompany, UiLastInvoice } from "./ui";
import type { SubscriptionPlanKey, PagarmeInvoiceStatus } from "./status";

/**
 * Converte o retorno do use case `ListSubscriptionsForPlatform`
 * (com JOIN de company + plan) para a forma que a UI espera.
 */
export function subscriptionToUiRow(
    row: WithSupabaseEmbeds<PagarmeSubscriptionWithLastInvoice>
): UiSubscriptionRow {
    const company: UiCompany | null = row.companies
        ? {
              id: row.companyId,
              name: row.companies.name ?? "(sem nome)",
              slug: row.companies.slug,
              is_active: row.companies.is_active ?? false,
          }
        : null;

    const plan: UiPlan | null = row.plans
        ? {
              id: row.plans.id,
              key: row.plans.key as SubscriptionPlanKey,
              name: row.plans.name,
              price_cents: row.plans.price_cents,
          }
        : null;

    const last_invoice: UiLastInvoice | null = row.lastInvoiceId
        ? {
              id: row.lastInvoiceId,
              amount: row.lastInvoiceAmount ?? 0,
              status: (row.lastInvoiceStatus ?? "pending") as PagarmeInvoiceStatus,
              due_at: row.lastInvoiceDueAt?.toISOString() ?? new Date().toISOString(),
              paid_at: row.lastInvoicePaidAt?.toISOString() ?? null,
          }
        : null;

    return {
        id: row.id,
        status: row.status,
        plan_key: row.planKey,
        allow_overage: row.allowOverage,
        trial_ends_at: row.trialEndsAt?.toISOString() ?? null,
        last_paid_at: row.lastPaidAt?.toISOString() ?? null,
        next_billing_at: row.nextBillingAt?.toISOString() ?? null,
        activated_at: row.activatedAt?.toISOString() ?? null,
        started_at: row.startedAt?.toISOString() ?? null,
        company,
        plan,
        last_invoice,
    };
}
