/**
 * Mappers — converte shape canônico de domínio (do use case) para shape
 * de UI (que a página React consome).
 *
 * Mantém a separação: domain (UI-independente) vs UI (pronto pra render).
 */

import type {
    PagarmeSubscriptionWithLastInvoice,
    PagarmeSubscriptionWithCompany,
    WithSupabaseEmbeds,
} from "./subscription";
import type {
    UiSubscriptionRow,
    UiPlan,
    UiCompany,
    UiLastInvoice,
    UiNeverPaidTenant,
} from "./ui";
import type { SubscriptionPlanKey, PagarmeInvoiceStatus } from "./status";
import type { Invoice } from "./invoice";
import { normalizePlanKey } from "../planCatalog";

function companyDisplayName(row: PagarmeSubscriptionWithCompany): string {
    const name = row.companyName?.trim();
    return name && name !== "(sem nome)" ? name : "(sem nome)";
}

function companyFromDomain(row: PagarmeSubscriptionWithCompany): UiCompany {
    return {
        id: row.companyId,
        name: companyDisplayName(row),
        slug: row.companySlug,
        email: row.companyEmail ?? null,
        is_active: row.companyIsActive,
    };
}

function planFromDomain(
    row: PagarmeSubscriptionWithCompany & WithSupabaseEmbeds<PagarmeSubscriptionWithCompany>
): UiPlan | null {
    if (row.plans) {
        return {
            id: row.plans.id,
            key: (normalizePlanKey(row.plans.key) ?? "essencial") as SubscriptionPlanKey,
            name: row.plans.name,
            price_cents: row.plans.price_cents,
        };
    }
    if (row.planId || row.planKey || row.planName) {
        return {
            id: row.planId ?? row.planKey ?? "unknown",
            key: (normalizePlanKey(row.planKey) ?? "essencial") as SubscriptionPlanKey,
            name: row.planName ?? row.planKey ?? "—",
            price_cents: row.planPriceCents ?? 0,
        };
    }
    return null;
}

/**
 * Converte o retorno do use case `ListSubscriptionsForPlatform`
 * para a forma que a UI espera.
 *
 * Fonte canônica: campos flat do domain (`companyName`, `companyEmail`, …).
 * Embeds Supabase (`companies`/`plans`) só como fallback legado.
 */
export function subscriptionToUiRow(
    row: WithSupabaseEmbeds<PagarmeSubscriptionWithLastInvoice>
): UiSubscriptionRow {
    const company: UiCompany | null = row.companyId
        ? companyFromDomain(row)
        : row.companies
          ? {
                id: row.companyId,
                name: row.companies.name ?? "(sem nome)",
                slug: row.companies.slug,
                email: null,
                is_active: row.companies.is_active ?? false,
            }
          : null;

    const plan = planFromDomain(row);

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

/** Domain never-paid → contrato UI da tab Sem pagamento. */
export function neverPaidTenantToUi(
    row: PagarmeSubscriptionWithCompany & { pendingInvoice: Invoice | null }
): UiNeverPaidTenant {
    const inv = row.pendingInvoice;
    return {
        subscriptionId: row.id,
        companyId: row.companyId,
        companyName: companyDisplayName(row),
        email: row.companyEmail ?? null,
        cnpj: null,
        whatsappPhone: null,
        isActive: row.companyIsActive,
        companyCreatedAt: row.startedAt?.toISOString() ?? null,
        plan: row.planName ?? row.planKey ?? "—",
        billingStatus: row.status,
        trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
        pendingInvoice: inv
            ? {
                  id: inv.id,
                  amount: inv.amount,
                  dueAt: inv.dueAt.toISOString(),
                  hasPix: inv.hasPix,
                  pixQrCode: inv.pixQrCode,
                  paymentUrl: inv.paymentUrl,
              }
            : null,
    };
}
