/**
 * Teste do adapter SupabaseInvoiceRepository.
 * Valida o mapeamento row → domain e filtros.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseInvoiceRepository } from "../../../../lib/billing/adapters/supabaseInvoiceRepository";

function makeClient(responses: {
  list?: { data: unknown[]; error: null | { message: string } };
  byId?: { data: unknown | null; error: null | { message: string } };
}): SupabaseClient {
  return {
    from() {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: async () => responses.byId ?? { data: null, error: null },
        then: (resolve: any, reject: any) =>
          Promise.resolve(responses.list ?? { data: [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("SupabaseInvoiceRepository — mapeamento row → domain", () => {
  const FIXED = "2026-04-01T10:00:00.000Z";

  it("list(): converte row completa em Invoice domain", async () => {
    const client = makeClient({
      list: {
        data: [
          {
            id: "i-1",
            company_id: "c-1",
            subscription_id: "s-1",
            amount: 297, // number vindo do banco
            status: "paid",
            due_at: FIXED,
            paid_at: FIXED,
            pagarme_order_id: "or_xxx",
            pix_qr_code: "qr-pix-text",
            pagarme_payment_url: "https://pay.example/abc",
            created_at: FIXED,
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseInvoiceRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows.length, 1);
    const r = rows[0]!;
    assert.strictEqual(r.id, "i-1");
    assert.strictEqual(r.amount, 297);
    assert.strictEqual(r.status, "paid");
    assert.strictEqual(r.dueAt.toISOString(), FIXED);
    assert.strictEqual(r.paidAt?.toISOString(), FIXED);
    assert.strictEqual(r.hasPix, true);
    assert.strictEqual(r.pixQrCode, "qr-pix-text");
    assert.strictEqual(r.paymentUrl, "https://pay.example/abc");
  });

  it("list(): converte amount como string (Postgres numeric)", async () => {
    // numeric/decimal pode vir como string dependendo do driver
    const client = makeClient({
      list: {
        data: [
          {
            id: "i-2",
            company_id: "c-2",
            subscription_id: null,
            amount: "99.50", // string
            status: "pending",
            due_at: FIXED,
            paid_at: null,
            pagarme_order_id: null,
            pix_qr_code: null,
            pagarme_payment_url: null,
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseInvoiceRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]!.amount, 99.5);
    assert.strictEqual(rows[0]!.hasPix, false);
    assert.strictEqual(rows[0]!.paidAt, null);
  });

  it("hasPix: true só quando pix_qr_code é string não-vazia", async () => {
    const client = makeClient({
      list: {
        data: [
          {
            id: "i-3",
            company_id: "c-3",
            subscription_id: null,
            amount: 100,
            status: "pending",
            due_at: FIXED,
            paid_at: null,
            pagarme_order_id: null,
            pix_qr_code: "   ", // só whitespace → não tem pix real
            pagarme_payment_url: null,
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseInvoiceRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows[0]!.hasPix, false);
  });

  it("lastByCompany(): retorna só a mais recente por empresa", async () => {
    const client = makeClient({
      list: {
        data: [
          { id: "i-1", company_id: "c-A", subscription_id: null, amount: 100, status: "pending", due_at: FIXED, paid_at: null, pagarme_order_id: null, pix_qr_code: null, pagarme_payment_url: null, created_at: "2026-04-15T10:00:00Z" },
          { id: "i-2", company_id: "c-A", subscription_id: null, amount: 100, status: "paid", due_at: FIXED, paid_at: FIXED, pagarme_order_id: null, pix_qr_code: null, pagarme_payment_url: null, created_at: "2026-04-10T10:00:00Z" },
          { id: "i-3", company_id: "c-B", subscription_id: null, amount: 50, status: "pending", due_at: FIXED, paid_at: null, pagarme_order_id: null, pix_qr_code: null, pagarme_payment_url: null, created_at: "2026-04-12T10:00:00Z" },
        ],
        error: null,
      },
    });
    const repo = new SupabaseInvoiceRepository(client);
    const map = await repo.lastByCompany(["c-A", "c-B", "c-C"]);
    assert.strictEqual(map.size, 2);
    // c-A mais recente: i-1 (2026-04-15)
    assert.strictEqual(map.get("c-A")?.id, "i-1");
    // c-B mais recente: i-3
    assert.strictEqual(map.get("c-B")?.id, "i-3");
    // c-C: não tem invoice
    assert.ok(!map.has("c-C"));
  });

  it("findById(): null quando não encontrado", async () => {
    const client = makeClient({ byId: { data: null, error: null } });
    const repo = new SupabaseInvoiceRepository(client);
    const r = await repo.findById("inexistente");
    assert.strictEqual(r, null);
  });
});
