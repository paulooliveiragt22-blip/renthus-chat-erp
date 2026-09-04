/**
 * Teste do adapter SupabaseSubscriptionRepository.
 *
 * Como o adapter depende do SupabaseClient (que requer network), validamos
 * indiretamente:
 *  1. Verificando que o construtor aceita o client
 *  2. Mockando o client com stub controlado e validando o mapeamento
 *     de rows → domain objects
 *
 * Para validar o mapeamento, importamos a função de mapeamento indiretamente
 * via o adapter, mas como ela é interna (não exportada), testamos via
 * mocks do queryBuilder do SupabaseClient.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseSubscriptionRepository } from "../../../../lib/billing/adapters/supabaseSubscriptionRepository";

/**
 * QueryBuilder fake: encadeia .select/.eq/.in/.order/.limit/.range retornando
 * o `data` configurado via .then() (encadeável até `.then` final).
 *
 * O adapter usa .maybeSingle() em findById/findByCompany e consome .then()
 * (Promise) em list*. Cada `from(table)` retorna um novo builder.
 */
function makeClient(responses: {
  list?: { data: unknown[]; error: null | { message: string } };
  invoices?: { data: unknown[]; error: null | { message: string } };
  byId?: { data: unknown | null; error: null | { message: string } };
}): SupabaseClient {
  return {
    from(table: string) {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        range: () => builder,
        maybeSingle: async () => responses.byId ?? { data: null, error: null },
        then: (resolve: any, reject: any) => {
          if (table === "invoices") {
            return Promise.resolve(responses.invoices ?? { data: [], error: null }).then(resolve, reject);
          }
          return Promise.resolve(responses.list ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("SupabaseSubscriptionRepository — mapeamento row → domain", () => {
  it("instancia com SupabaseClient", () => {
    const client = makeClient({});
    const repo = new SupabaseSubscriptionRepository(client);
    assert.ok(repo instanceof SupabaseSubscriptionRepository);
  });

  it("list(): converte row completa (com company embed) em domain", async () => {
    const FIXED = "2026-04-01T10:00:00.000Z";
    const client = makeClient({
      list: {
        data: [
          {
            id: "s-1",
            company_id: "c-1",
            plan_key: "essencial",
            plan_id: "p-1",
            status: "active",
            allow_overage: true,
            trial_ends_at: null,
            last_paid_at: FIXED,
            next_billing_at: FIXED,
            activated_at: FIXED,
            started_at: FIXED,
            companies: {
              name: "Loja X",
              nome_fantasia: null,
              slug: "loja-x",
              email: "loja@x.com",
              is_active: true,
            },
            plans: { id: "p-1", key: "essencial", name: "Essencial", price_cents: 27900 },
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseSubscriptionRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows.length, 1);
    const r = rows[0]!;
    assert.strictEqual(r.id, "s-1");
    assert.strictEqual(r.companyId, "c-1");
    assert.strictEqual(r.planKey, "essencial");
    assert.strictEqual(r.status, "active");
    assert.strictEqual(r.allowOverage, true);
    assert.strictEqual(r.companyName, "Loja X");
    assert.strictEqual(r.companySlug, "loja-x");
    assert.strictEqual(r.companyIsActive, true);
    assert.strictEqual(r.companyEmail, "loja@x.com");
    assert.strictEqual(r.planName, "Essencial");
    assert.strictEqual(r.planPriceCents, 27900);
    assert.strictEqual(r.lastPaidAt?.toISOString(), FIXED);
  });

  it("list(): prefer nome_fantasia como companyName", async () => {
    const client = makeClient({
      list: {
        data: [
          {
            id: "s-1",
            company_id: "c-1",
            plan_key: "pro",
            plan_id: "p-2",
            status: "active",
            allow_overage: false,
            trial_ends_at: null,
            last_paid_at: null,
            next_billing_at: null,
            activated_at: null,
            started_at: null,
            companies: {
              name: "Razao Social LTDA",
              nome_fantasia: "Fantasia Bar",
              slug: "fantasia",
              email: "a@b.com",
              is_active: true,
            },
            plans: null,
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseSubscriptionRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows[0]!.companyName, "Fantasia Bar");
    assert.strictEqual(rows[0]!.companyEmail, "a@b.com");
  });

  it("list(): aceita company embed como array (Supabase retorna [] quando null)", async () => {
    const client = makeClient({
      list: {
        data: [
          {
            id: "s-1",
            company_id: "c-1",
            plan_key: null,
            plan_id: null,
            status: "pending_payment",
            allow_overage: false,
            trial_ends_at: null,
            last_paid_at: null,
            next_billing_at: null,
            activated_at: null,
            started_at: null,
            companies: [], // array vazio quando LEFT JOIN null
            plans: null,
          },
        ],
        error: null,
      },
    });
    const repo = new SupabaseSubscriptionRepository(client);
    const rows = await repo.list({});
    assert.strictEqual(rows.length, 1);
    // Sem company embed → fallback "(sem nome)" + is_active false
    assert.strictEqual(rows[0]!.companyName, "(sem nome)");
    assert.strictEqual(rows[0]!.companyIsActive, false);
    assert.strictEqual(rows[0]!.companyEmail, null);
  });

  it("findById(): retorna null quando não encontrado", async () => {
    const client = makeClient({ byId: { data: null, error: null } });
    const repo = new SupabaseSubscriptionRepository(client);
    const r = await repo.findById("inexistente");
    assert.strictEqual(r, null);
  });

  it("findByCompany(): retorna sem companyName (shape mínimo)", async () => {
    const client = makeClient({
      byId: {
        data: {
          id: "s-1",
          company_id: "c-1",
          plan_key: "market",
          plan_id: "p-2",
          status: "active",
          allow_overage: false,
          trial_ends_at: null,
          last_paid_at: "2026-01-01T00:00:00Z",
          next_billing_at: null,
          activated_at: null,
          started_at: null,
        },
        error: null,
      },
    });
    const repo = new SupabaseSubscriptionRepository(client);
    const r = await repo.findByCompany("c-1");
    assert.ok(r);
    assert.ok(!("companyName" in r!));
    assert.strictEqual(r!.companyId, "c-1");
    assert.strictEqual(r!.planKey, "market");
  });
});
