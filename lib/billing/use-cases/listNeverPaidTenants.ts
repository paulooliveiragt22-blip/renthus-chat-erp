/**
 * Use Case — ListNeverPaidTenants
 *
 * Lista empresas que NUNCA pagaram (para o super admin cobrar).
 *
 * Usa o helper puro isNeverPaid (do contracts/status) que cobre:
 *  - status pending_payment / pending_setup / abandoned
 *  - status trial + trial vencido + last_paid_at null (bug fix do print02)
 *
 * Enriquece cada subscription com a invoice pendente (status=pending) da empresa.
 */

import type {
  SubscriptionRepositoryPort,
  SubscriptionFilter,
} from "../ports/subscriptionRepository";
import type { InvoiceRepositoryPort, InvoiceFilter } from "../ports/invoiceRepository";
import type { BillingNotifierPort } from "../ports/billingNotifier";
import type { PagarmeSubscriptionWithCompany } from "../contracts/subscription";
import type { Invoice } from "../contracts/invoice";

export interface NeverPaidTenantItem extends PagarmeSubscriptionWithCompany {
  pendingInvoice: Invoice | null;
}

export interface ListNeverPaidTenantsInput {
  filter?: SubscriptionFilter;
  /** Limite opcional (0 = sem limite). Default 100. */
  limit?: number;
}

export class ListNeverPaidTenants {
  constructor(
    private readonly subscriptions: SubscriptionRepositoryPort,
    private readonly invoices: InvoiceRepositoryPort,
    private readonly notifier: BillingNotifierPort
  ) {}

  async execute(input: ListNeverPaidTenantsInput = {}): Promise<NeverPaidTenantItem[]> {
    const limit = input.limit && input.limit > 0 ? input.limit : 100;
    const filter: SubscriptionFilter = {
      ...(input.filter ?? {}),
      limit: input.filter?.limit ?? limit,
      offset: input.filter?.offset,
    };
    const sliced = await this.subscriptions.listNeverPaid(filter);

    // Buscar invoices pendentes em batch
    const companyIds = sliced.map((s) => s.companyId);
    const invFilter: InvoiceFilter = {
      companyIds,
      status: "pending",
    };
    const allInvoices = await this.invoices.list(invFilter);

    // Map: companyId → invoice pendente mais recente
    const pendingByCompany = new Map<string, Invoice>();
    for (const inv of allInvoices) {
      const existing = pendingByCompany.get(inv.companyId);
      if (!existing || inv.dueAt.getTime() > existing.dueAt.getTime()) {
        pendingByCompany.set(inv.companyId, inv);
      }
    }

    const tenants: NeverPaidTenantItem[] = sliced.map((s) => ({
      ...s,
      pendingInvoice: pendingByCompany.get(s.companyId) ?? null,
    }));

    await this.notifier.publish({
      kind: "subscription_status_changed",
      scope: "platform-billing-never-paid",
      message: `listed ${tenants.length} never-paid tenants`,
      extra: { count: tenants.length },
      occurredAt: new Date(),
    });

    return tenants;
  }
}
