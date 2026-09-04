/**
 * Teste do use case ListNeverPaidTenants.
 *
 * Validação crítica: o helper isNeverPaid (do contracts/status) é usado
 * pela port SubscriptionRepository.listNeverPaid. Aqui validamos que o
 * use case propaga o resultado + enriquecimento com invoice pendente.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SubscriptionRepositoryPort, SubscriptionFilter } from "../../../../lib/billing/ports/subscriptionRepository";
import type { InvoiceRepositoryPort } from "../../../../lib/billing/ports/invoiceRepository";
import type { BillingNotifierPort, BillingEvent } from "../../../../lib/billing/ports/billingNotifier";
import type { PagarmeSubscriptionWithCompany } from "../../../../lib/billing/contracts/subscription";
import type { Invoice } from "../../../../lib/billing/contracts/invoice";
import { ListNeverPaidTenants } from "../../../../lib/billing/use-cases/listNeverPaidTenants";
import { isNeverPaid } from "../../../../lib/billing/contracts/status";

function makeSub(overrides: Partial<PagarmeSubscriptionWithCompany>): PagarmeSubscriptionWithCompany {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    companyId: overrides.companyId ?? crypto.randomUUID(),
    planKey: overrides.planKey ?? null,
    planId: overrides.planId ?? null,
    status: overrides.status ?? "active",
    allowOverage: overrides.allowOverage ?? false,
    trialEndsAt: overrides.trialEndsAt ?? null,
    lastPaidAt: overrides.lastPaidAt ?? null,
    nextBillingAt: overrides.nextBillingAt ?? null,
    activatedAt: overrides.activatedAt ?? null,
    startedAt: overrides.startedAt ?? null,
    companyName: overrides.companyName ?? "X",
    companySlug: overrides.companySlug ?? null,
    companyIsActive: overrides.companyIsActive ?? true,
  };
}

/** Repo que usa isNeverPaid puro (igual ao adapter real faz). */
class NeverPaidRepo implements SubscriptionRepositoryPort {
  constructor(public rows: PagarmeSubscriptionWithCompany[] = []) {}
  async list() { return this.rows; }
  async listNeverPaid(filter?: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]> {
    let rows = this.rows.filter((r) => isNeverPaid({
      status: r.status,
      last_paid_at: r.lastPaidAt ? r.lastPaidAt.toISOString() : null,
      trial_ends_at: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
    }));
    if (filter?.statuses?.length) {
      const allowed = new Set(filter.statuses);
      rows = rows.filter((r) => allowed.has(r.status));
    }
    if (filter?.companyId) rows = rows.filter((r) => r.companyId === filter.companyId);
    if (filter?.planKey) rows = rows.filter((r) => r.planKey === filter.planKey);
    const offset = filter?.offset ?? 0;
    if (filter?.limit != null) rows = rows.slice(offset, offset + filter.limit);
    else if (offset > 0) rows = rows.slice(offset);
    return rows;
  }
  async listWithLastInvoice() { return []; }
  async findById(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
  async findByCompany(companyId: string) { return this.rows.find((r) => r.companyId === companyId) ?? null; }
}

class InMemoryInvoiceRepo implements InvoiceRepositoryPort {
  constructor(public rows: Invoice[] = []) {}
  async list() { return this.rows; }
  async lastByCompany() { return new Map(); }
  async findById(id: string) { return this.rows.find((r) => r.id === id) ?? null; }
}

class InMemoryNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];
  async publish(event: BillingEvent) { this.events.push(event); }
}

describe("ListNeverPaidTenants — orquestração (validação crítica do bug do print02)", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000);
  const PAST = new Date(Date.now() - 1 * 86_400_000);

  const seed: PagarmeSubscriptionWithCompany[] = [
    makeSub({ id: "s1", companyId: "c1", status: "pending_payment", companyName: "Ferrester" }),
    makeSub({ id: "s2", companyId: "c2", status: "pending_setup", companyName: "hokk" }),
    makeSub({ id: "s3", companyId: "c3", status: "abandoned", companyName: "louca bebidas" }),
    makeSub({ id: "s4", companyId: "c4", status: "trial", trialEndsAt: FUTURE, companyName: "trial ativo" }),
    makeSub({ id: "s5", companyId: "c5", status: "trial", trialEndsAt: PAST, companyName: "trial vencido" }),
    makeSub({ id: "s6", companyId: "c6", status: "active", lastPaidAt: new Date(), companyName: "pagou" }),
  ];

  it("execute(): retorna never-paid (pending_payment/pending_setup/abandoned/trial vencido)", async () => {
    const subs = new NeverPaidRepo(seed);
    const invoices = new InMemoryInvoiceRepo();
    const notifier = new InMemoryNotifier();

    const uc = new ListNeverPaidTenants(subs, invoices, notifier);
    const result = await uc.execute();

    const ids = result.map((r) => r.id).sort();
    assert.deepStrictEqual(ids, ["s1", "s2", "s3", "s5"]);
  });

  it("execute(): limita o número de resultados", async () => {
    const subs = new NeverPaidRepo(seed);
    const uc = new ListNeverPaidTenants(subs, new InMemoryInvoiceRepo(), new InMemoryNotifier());
    const result = await uc.execute({ limit: 2 });
    assert.strictEqual(result.length, 2);
  });

  it("execute(): cada tenant tem pendingInvoice=null se não há invoice pending", async () => {
    const subs = new NeverPaidRepo([makeSub({ id: "s1", companyId: "c1", status: "pending_payment" })]);
    const uc = new ListNeverPaidTenants(subs, new InMemoryInvoiceRepo(), new InMemoryNotifier());
    const [first] = await uc.execute();
    assert.strictEqual(first?.pendingInvoice, null);
  });

  it("execute(): publica evento de auditoria", async () => {
    const subs = new NeverPaidRepo(seed);
    const notifier = new InMemoryNotifier();
    const uc = new ListNeverPaidTenants(subs, new InMemoryInvoiceRepo(), notifier);
    await uc.execute();
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "subscription_status_changed");
  });
});
