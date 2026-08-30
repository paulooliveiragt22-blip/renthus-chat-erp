/**
 * Teste de contrato — InvoiceRepositoryPort
 *
 * Garante que QUALQUER implementação satisfaz o contrato mínimo:
 * filtragem, lastByCompany (uma invoice por empresa), findById.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InvoiceRepositoryPort, InvoiceFilter } from "../../../../lib/billing/ports/invoiceRepository";
import type { Invoice } from "../../../../lib/billing/contracts/invoice";

function makeInvoice(overrides: Partial<Invoice> & { companyId: string; createdAt?: Date }): Invoice & { createdAt: Date } {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    companyId: overrides.companyId,
    subscriptionId: overrides.subscriptionId ?? null,
    amount: overrides.amount ?? 297,
    status: overrides.status ?? "pending",
    dueAt: overrides.dueAt ?? new Date(),
    paidAt: overrides.paidAt ?? null,
    pagarmeOrderId: overrides.pagarmeOrderId ?? null,
    hasPix: overrides.hasPix ?? false,
    paymentUrl: overrides.paymentUrl ?? null,
    pixQrCode: overrides.pixQrCode ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

class InMemoryInvoiceRepository implements InvoiceRepositoryPort {
  private rows: Array<Invoice & { createdAt: Date }> = [];

  constructor(seed: Array<Invoice & { createdAt: Date }> = []) {
    this.rows = [...seed];
  }

  async list(filter: InvoiceFilter): Promise<Invoice[]> {
    let out = [...this.rows];
    if (filter.companyIds?.length) {
      out = out.filter((r) => (filter.companyIds as readonly string[]).includes(r.companyId));
    }
    if (filter.status) {
      out = out.filter((r) => r.status === filter.status);
    }
    if (filter.statuses?.length) {
      out = out.filter((r) => (filter.statuses as readonly string[]).includes(r.status));
    }
    if (filter.subscriptionId) {
      out = out.filter((r) => r.subscriptionId === filter.subscriptionId);
    }
    return out.map(({ createdAt: _, ...rest }) => rest);
  }

  async lastByCompany(companyIds: readonly string[]): Promise<Map<string, Invoice>> {
    const result = new Map<string, Invoice>();
    for (const cid of companyIds) {
      const candidates = this.rows
        .filter((r) => r.companyId === cid)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const top = candidates[0];
      if (top) {
        const { createdAt: _, ...rest } = top;
        result.set(cid, rest);
      }
    }
    return result;
  }

  async findById(id: string): Promise<Invoice | null> {
    const r = this.rows.find((row) => row.id === id);
    if (!r) return null;
    const { createdAt: _, ...rest } = r;
    return rest;
  }
}

describe("InvoiceRepositoryPort — contrato", () => {
  const T1 = new Date("2026-04-01T10:00:00Z");
  const T2 = new Date("2026-04-15T10:00:00Z");
  const T3 = new Date("2026-05-01T10:00:00Z");

  const seed: Array<Invoice & { createdAt: Date }> = [
    makeInvoice({ id: "i1", companyId: "c1", amount: 297, status: "pending", createdAt: T1 }),
    makeInvoice({ id: "i2", companyId: "c1", amount: 297, status: "paid", paidAt: T2, createdAt: T2 }),
    makeInvoice({ id: "i3", companyId: "c2", amount: 99, status: "pending", createdAt: T3 }),
    makeInvoice({ id: "i4", companyId: "c3", amount: 500, status: "failed", createdAt: T3 }),
    makeInvoice({ id: "i5", companyId: "c2", amount: 99, status: "pending", createdAt: T1 }),
  ];

  const repo = new InMemoryInvoiceRepository(seed);

  it("list(): retorna todas sem filtro", async () => {
    const all = await repo.list({});
    assert.strictEqual(all.length, 5);
  });

  it("list(): filtra por companyIds", async () => {
    const out = await repo.list({ companyIds: ["c1"] });
    assert.strictEqual(out.length, 2);
    assert.ok(out.every((i) => i.companyId === "c1"));
  });

  it("list(): filtra por status", async () => {
    const out = await repo.list({ status: "pending" });
    assert.strictEqual(out.length, 3);
    assert.ok(out.every((i) => i.status === "pending"));
  });

  it("list(): combina companyIds + status", async () => {
    // c1 tem i1 (pending), c2 tem i3 (pending) + i5 (pending) = 3 invoices pending
    const out = await repo.list({ companyIds: ["c1", "c2"], status: "pending" });
    assert.strictEqual(out.length, 3);
    assert.ok(out.every((i) => i.status === "pending"));
    assert.ok(out.every((i) => i.companyId === "c1" || i.companyId === "c2"));
  });

  it("lastByCompany(): retorna só a mais recente por empresa", async () => {
    const map = await repo.lastByCompany(["c1", "c2", "c3"]);
    assert.strictEqual(map.size, 3);
    // c1: mais recente é i2 (T2 > T1)
    assert.strictEqual(map.get("c1")?.id, "i2");
    assert.strictEqual(map.get("c1")?.status, "paid");
    // c2: mais recente é i3 (T3 > T1)
    assert.strictEqual(map.get("c2")?.id, "i3");
    // c3: só tem i4
    assert.strictEqual(map.get("c3")?.id, "i4");
  });

  it("lastByCompany(): ignora empresas sem invoice", async () => {
    const map = await repo.lastByCompany(["c1", "c999"]);
    assert.strictEqual(map.size, 1);
    assert.ok(!map.has("c999"));
  });

  it("findById(): retorna invoice correto", async () => {
    const found = await repo.findById("i2");
    assert.ok(found);
    assert.strictEqual(found?.id, "i2");
    assert.strictEqual(found?.status, "paid");
  });

  it("findById(): null para inexistente", async () => {
    const found = await repo.findById("nao-existe");
    assert.strictEqual(found, null);
  });
});
