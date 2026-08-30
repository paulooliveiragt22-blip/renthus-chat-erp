/**
 * Use Case — ListSubscriptionsForPlatform
 *
 * Orquestra listagem de assinaturas para a UI do super admin:
 *  1. Lista subscriptions via SubscriptionRepositoryPort
 *  2. Enriquece com a última invoice de cada empresa (1 round-trip via IN)
 *  3. Notifica evento de auditoria
 *
 * Puro em relação ao banco: depende apenas dos ports.
 */

import type {
  SubscriptionRepositoryPort,
  SubscriptionFilter,
} from "../ports/subscriptionRepository";
import type { InvoiceRepositoryPort } from "../ports/invoiceRepository";
import type { BillingNotifierPort } from "../ports/billingNotifier";
import type { PagarmeSubscriptionWithCompany, PagarmeSubscriptionWithLastInvoice } from "../contracts/subscription";

export interface ListSubscriptionsForPlatformInput {
  filter?: SubscriptionFilter;
}

export class ListSubscriptionsForPlatform {
  constructor(
    private readonly subscriptions: SubscriptionRepositoryPort,
    private readonly invoices: InvoiceRepositoryPort,
    private readonly notifier: BillingNotifierPort
  ) {}

  async execute(
    input: ListSubscriptionsForPlatformInput = {}
  ): Promise<PagarmeSubscriptionWithLastInvoice[]> {
    const subs = await this.subscriptions.list(input.filter ?? {});

    // Enriquece com lastInvoice em 1 round-trip via IN
    const companyIds = subs.map((s) => s.companyId);
    const invoiceMap = await this.invoices.lastByCompany(companyIds);

    const enriched: PagarmeSubscriptionWithLastInvoice[] = subs.map((s) => {
      const inv = invoiceMap.get(s.companyId);
      return {
        ...s,
        lastInvoiceId: inv?.id ?? null,
        lastInvoiceAmount: inv?.amount ?? null,
        lastInvoiceStatus: inv?.status ?? null,
        lastInvoiceDueAt: inv?.dueAt ?? null,
        lastInvoicePaidAt: inv?.paidAt ?? null,
      };
    });

    await this.notifier.publish({
      kind: "subscription_status_changed",
      scope: "platform-billing",
      message: `listed ${enriched.length} subscriptions`,
      extra: {
        filterApplied: JSON.stringify(input.filter ?? {}),
        count: enriched.length,
      },
      occurredAt: new Date(),
    });

    return enriched;
  }
}

/** Tipo re-exportado para o front-end. */
export type { PagarmeSubscriptionWithCompany, PagarmeSubscriptionWithLastInvoice };
