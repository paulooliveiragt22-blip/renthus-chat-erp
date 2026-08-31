/**
 * Teste do use case ListSubscriptionsForPlatform.
 *
 * Usa InMemory das ports (definidas no teste) — verifica orquestração:
 *  1. Chama subscriptions.list(filter)
 *  2. Enriquece com invoices.lastByCompany
 *  3. Notifica evento
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SubscriptionRepositoryPort, SubscriptionFilter } from "../../../../lib/billing/ports/subscriptionRepository";
import type { InvoiceRepositoryPort } from "../../../../lib/billing/ports/invoiceRepository";
import type { BillingNotifierPort, BillingEvent } from "../../../../lib/billing/ports/billingNotifier";
import type {
  PagarmeSubscription,
  PagarmeSubscriptionWithCompany,
  PagarmeSubscriptionWithLastInvoice,
} from "../../../../lib/billing/contracts/subscription";
import type { Invoice } from "../../../../lib/billing/contracts/invoice";
import { ListSubscriptionsForPlatform } from "../../../../lib/billing/use-cases/listSubscriptionsForPlatform";

function makeSub(id: string, companyId: string): PagarmeSubscriptionWithCompany {
  return {
    id,
    companyId,
    planKey: "essencial",
    planId: null,
    status: "active",
    allowOverage: false,
    trialEndsAt: null,
    lastPaidAt: null,
    nextBillingAt: null,
    activatedAt: null,
    startedAt: null,
    companyName: `Company ${companyId}`,
    companySlug: null,
    companyIsActive: true,
  };
}

class InMemorySubRepo implements SubscriptionRepositoryPort {
  constructor(public rows: PagarmeSubscriptionWithCompany[] = []) {}
  list(filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]> {
    return Promise.resolve(this.rows.filter((r) => !filter.statuses?.length || (filter.statuses as readonly string[]).includes(r.status)));
  }
  listNeverPaid(): Promise<PagarmeSubscriptionWithCompany[]> {
    return Promise.resolve([]);
  }
  listWithLastInvoice(): Promise<PagarmeSubscriptionWithLastInvoice[]> {
    return Promise.resolve(this.rows.map((s) => ({
      ...s,
      lastInvoiceId: null,
      lastInvoiceAmount: null,
      lastInvoiceStatus: null,
      lastInvoiceDueAt: null,
      lastInvoicePaidAt: null,
    })));
  }
  findById(id: string): Promise<PagarmeSubscriptionWithCompany | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id) ?? null);
  }
  findByCompany(companyId: string): Promise<PagarmeSubscription | null> {
    return Promise.resolve(this.rows.find((r) => r.companyId === companyId) ?? null);
  }
}

class InMemoryInvoiceRepo implements InvoiceRepositoryPort {
  constructor(public rows: Invoice[] = []) {}
  list(): Promise<Invoice[]> { return Promise.resolve(this.rows); }
  lastByCompany(companyIds: readonly string[]): Promise<Map<string, Invoice>> {
    const m = new Map<string, Invoice>();
    for (const id of companyIds) {
      const cands = this.rows.filter((r) => r.companyId === id).sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime());
      const top = cands[0];
      if (top) m.set(id, top);
    }
    return Promise.resolve(m);
  }
  findById(id: string): Promise<Invoice | null> { return Promise.resolve(this.rows.find((r) => r.id === id) ?? null); }
}

class InMemoryNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];
  async publish(event: BillingEvent) { this.events.push(event); }
}

describe("ListSubscriptionsForPlatform — orquestração", () => {
  const T1 = new Date("2026-04-15T10:00:00Z");

  it("execute(): retorna lista enriquecida com última invoice", async () => {
    const subs = new InMemorySubRepo([
      makeSub("s1", "c1"),
      makeSub("s2", "c2"),
    ]);
    const invoices = new InMemoryInvoiceRepo([
      { id: "i1", companyId: "c1", subscriptionId: "s1", amount: 297, status: "paid", dueAt: T1, paidAt: T1, pagarmeOrderId: null, hasPix: false, paymentUrl: null, pixQrCode: null },
    ]);
    const notifier = new InMemoryNotifier();

    const uc = new ListSubscriptionsForPlatform(subs, invoices, notifier);
    const result = await uc.execute({});

    assert.strictEqual(result.length, 2);
    const c1Row = result.find((r) => r.companyId === "c1");
    assert.strictEqual(c1Row?.lastInvoiceId, "i1");
    assert.strictEqual(c1Row?.lastInvoiceAmount, 297);
    const c2Row = result.find((r) => r.companyId === "c2");
    assert.strictEqual(c2Row?.lastInvoiceId, null);
  });

  it("execute(): respeita filter (statuses)", async () => {
    const subs = new InMemorySubRepo([
      { ...makeSub("s1", "c1"), status: "active" },
      { ...makeSub("s2", "c2"), status: "pending_payment" },
    ]);
    const uc = new ListSubscriptionsForPlatform(subs, new InMemoryInvoiceRepo(), new InMemoryNotifier());
    const result = await uc.execute({ filter: { statuses: ["active"] } });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.id, "s1");
  });

  it("execute(): publica evento de auditoria", async () => {
    const subs = new InMemorySubRepo([makeSub("s1", "c1")]);
    const notifier = new InMemoryNotifier();
    const uc = new ListSubscriptionsForPlatform(subs, new InMemoryInvoiceRepo(), notifier);
    await uc.execute({});
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "subscription_status_changed");
  });

  it("execute(): propaga erro do repo", async () => {
    class FailingRepo implements SubscriptionRepositoryPort {
      async list(_filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]> {
        throw new Error("boom");
      }
      async listNeverPaid(): Promise<PagarmeSubscriptionWithCompany[]> {
        return [];
      }
      async listWithLastInvoice(_filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithLastInvoice[]> {
        return [];
      }
      async findById(_id: string): Promise<PagarmeSubscriptionWithCompany | null> {
        return null;
      }
      async findByCompany(_companyId: string): Promise<PagarmeSubscription | null> {
        return null;
      }
    }
    const uc = new ListSubscriptionsForPlatform(
      new FailingRepo(),
      new InMemoryInvoiceRepo(),
      new InMemoryNotifier()
    );
    await assert.rejects(uc.execute({}), /boom/);
  });
});
