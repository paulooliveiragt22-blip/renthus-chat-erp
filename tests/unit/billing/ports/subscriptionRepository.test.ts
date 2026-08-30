/**
 * Teste de contrato — SubscriptionRepositoryPort
 *
 * Garante que QUALQUER implementação do port satisfaz o contrato mínimo:
 * assinatura, retorno de tipos corretos, e filtragem respeitada.
 *
 * Estratégia: implementar uma versão InMemory do port e validar contra fixtures.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SubscriptionRepositoryPort, SubscriptionFilter } from "../../../../lib/billing/ports/subscriptionRepository";
import type {
  PagarmeSubscription,
  PagarmeSubscriptionWithCompany,
  PagarmeSubscriptionWithLastInvoice,
} from "../../../../lib/billing/contracts/subscription";
import type { PagarmeSubStatus } from "../../../../lib/billing/contracts/status";

function makeSub(overrides: Partial<PagarmeSubscription>): PagarmeSubscription {
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
  };
}

function withCompany(
  s: PagarmeSubscription,
  name = "Test Co",
  isActive = true
): PagarmeSubscriptionWithCompany {
  return {
    ...s,
    companyName: name,
    companySlug: null,
    companyIsActive: isActive,
  };
}

class InMemorySubscriptionRepository implements SubscriptionRepositoryPort {
  private rows: PagarmeSubscriptionWithCompany[] = [];

  constructor(seed: PagarmeSubscriptionWithCompany[] = []) {
    this.rows = [...seed];
  }

  async list(filter: SubscriptionFilter): Promise<PagarmeSubscriptionWithCompany[]> {
    let out = [...this.rows];
    if (filter.statuses?.length) {
      out = out.filter((r) => (filter.statuses as readonly string[]).includes(r.status));
    }
    if (filter.planKey) {
      out = out.filter((r) => r.planKey === filter.planKey);
    }
    if (filter.companyId) {
      out = out.filter((r) => r.companyId === filter.companyId);
    }
    if (filter.offset) out = out.slice(filter.offset);
    if (filter.limit) out = out.slice(0, filter.limit);
    return out;
  }

  async listNeverPaid(): Promise<PagarmeSubscriptionWithCompany[]> {
    const { isNeverPaid } = await import("../../../../lib/billing/contracts/status");
    return this.rows.filter((r) =>
      isNeverPaid({
        status: r.status,
        last_paid_at: r.lastPaidAt ? r.lastPaidAt.toISOString() : null,
        trial_ends_at: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
      })
    );
  }

  async listWithLastInvoice(): Promise<PagarmeSubscriptionWithLastInvoice[]> {
    return this.rows.map((r) => ({
      ...r,
      lastInvoiceId: null,
      lastInvoiceAmount: null,
      lastInvoiceStatus: null,
      lastInvoiceDueAt: null,
      lastInvoicePaidAt: null,
    }));
  }

  async findById(id: string): Promise<PagarmeSubscriptionWithCompany | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByCompany(companyId: string): Promise<PagarmeSubscription | null> {
    const r = this.rows.find((r) => r.companyId === companyId);
    if (!r) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { companyName, companySlug, companyIsActive, ...rest } = r;
    return rest;
  }
}
describe("SubscriptionRepositoryPort — contrato", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000);
  const PAST = new Date(Date.now() - 1 * 86_400_000);

  const seed: PagarmeSubscriptionWithCompany[] = [
    withCompany(makeSub({ id: "s1", companyId: "c1", status: "active", planKey: "essencial", lastPaidAt: new Date("2026-04-01") })),
    withCompany(makeSub({ id: "s2", companyId: "c2", status: "pending_payment", planKey: "essencial" })),
    withCompany(makeSub({ id: "s3", companyId: "c3", status: "pending_setup", planKey: "essencial" })),
    withCompany(makeSub({ id: "s4", companyId: "c4", status: "trial", planKey: "essencial", trialEndsAt: FUTURE })),
    withCompany(makeSub({ id: "s5", companyId: "c5", status: "trial", planKey: "market", trialEndsAt: PAST })),
    withCompany(makeSub({ id: "s6", companyId: "c6", status: "active", planKey: "market", lastPaidAt: new Date("2026-01-15") })),
  ];

  const repo = new InMemorySubscriptionRepository(seed);

  it("list(): retorna todos sem filtro", async () => {
    const all = await repo.list({});
    assert.strictEqual(all.length, 6);
  });

  it("list(): filtra por status (OR)", async () => {
    const filtered = await repo.list({ statuses: ["active"] });
    assert.strictEqual(filtered.length, 2);
    assert.ok(filtered.every((r) => r.status === "active"));
  });

  it("list(): filtra por múltiplos statuses", async () => {
    const filtered = await repo.list({
      statuses: ["pending_payment", "pending_setup"] as const as readonly PagarmeSubStatus[],
    });
    assert.strictEqual(filtered.length, 2);
  });

  it("list(): filtra por planKey", async () => {
    const filtered = await repo.list({ planKey: "market" });
    assert.strictEqual(filtered.length, 2);
    assert.ok(filtered.every((r) => r.planKey === "market"));
  });

  it("list(): filtra por companyId", async () => {
    const filtered = await repo.list({ companyId: "c2" });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0]?.id, "s2");
  });

  it("list(): combina filtros (status + planKey)", async () => {
    const filtered = await repo.list({
      statuses: ["active"] as const,
      planKey: "essencial",
    });
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0]?.id, "s1");
  });

  it("listNeverPaid(): exclui pagos e trials ativos; inclui trials vencidos", async () => {
    const neverPaid = await repo.listNeverPaid();
    // s1 active (pago): fora
    // s2 pending_payment: dentro
    // s3 pending_setup: dentro
    // s4 trial ativo: fora
    // s5 trial vencido sem pagamento: dentro (helper isNeverPaid)
    // s6 active (pago): fora
    const ids = neverPaid.map((r) => r.id).sort();
    assert.deepStrictEqual(ids, ["s2", "s3", "s5"]);
  });

  it("findById(): retorna o registro correto", async () => {
    const found = await repo.findById("s1");
    assert.ok(found);
    assert.strictEqual(found.id, "s1");
    assert.strictEqual(found.companyName, "Test Co");
  });

  it("findById(): retorna null para id inexistente", async () => {
    const found = await repo.findById("nao-existe");
    assert.strictEqual(found, null);
  });

  it("findByCompany(): retorna subscription sem companyName", async () => {
    const found = await repo.findByCompany("c1");
    assert.ok(found);
    assert.strictEqual(found.companyId, "c1");
    assert.ok(!("companyName" in found), "findByCompany deve omitir companyName");
  });

  it("findByCompany(): retorna null para companyId inexistente", async () => {
    const found = await repo.findByCompany("c999");
    assert.strictEqual(found, null);
  });
});