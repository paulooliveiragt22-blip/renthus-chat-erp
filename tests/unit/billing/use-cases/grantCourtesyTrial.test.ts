/**
 * Teste do use case GrantCourtesyTrial.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BillingNotifierPort, BillingEvent } from "../../../../lib/billing/ports/billingNotifier";
import { GrantCourtesyTrial, type RpcExecutor } from "../../../../lib/billing/use-cases/grantCourtesyTrial";
import { fakeActor } from "./_fakeActor";

function fakeRpc(returns: { data?: unknown; error?: { message: string } } = {}): RpcExecutor {
  return async (fn, args) => {
    if (returns.error) return { data: null, error: returns.error };
    return { data: returns.data ?? new Date().toISOString(), error: null };
  };
}

class InMemoryNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];
  async publish(event: BillingEvent) { this.events.push(event); }
}

describe("GrantCourtesyTrial — validações + RPC + notifier", () => {
  it("execute(): chama RPC com args corretos", async () => {
    const captured: { fn: string; args: Record<string, unknown> } = { fn: "", args: {} };
    const rpc: RpcExecutor = async (fn, args) => {
      captured.fn = fn;
      captured.args = args;
      return { data: "2026-09-01T00:00:00Z", error: null };
    };
    const notifier = new InMemoryNotifier();
    const uc = new GrantCourtesyTrial(rpc, notifier);
    const result = await uc.execute({
      companyId: "c-1",
      days: 7,
      planKey: "essencial",
      reason: "vip",
      actor: fakeActor(),
    });

    assert.strictEqual(captured.fn, "rpc_platform_grant_courtesy_trial");
    assert.strictEqual(captured.args.p_company_id, "c-1");
    assert.strictEqual(captured.args.p_days, 7);
    assert.strictEqual(captured.args.p_reason, "vip");
    assert.strictEqual(captured.args.p_actor_id, "actor-1");
    assert.strictEqual(captured.args.p_actor_role, "superadmin");
    assert.ok(result.trialEndsAt instanceof Date);
  });

  it("execute(): rejeita companyId vazio", async () => {
    const uc = new GrantCourtesyTrial(fakeRpc(), new InMemoryNotifier());
    await assert.rejects(
      uc.execute({ companyId: "", days: 7, planKey: "essencial", actor: fakeActor() }),
      /companyId required/
    );
  });

  it("execute(): rejeita days fora de [1, 14]", async () => {
    const uc = new GrantCourtesyTrial(fakeRpc(), new InMemoryNotifier());
    await assert.rejects(
      uc.execute({ companyId: "c-1", days: 0, planKey: "essencial", actor: fakeActor() }),
      /courtesy_trial_days_invalid/
    );
    await assert.rejects(
      uc.execute({ companyId: "c-1", days: 15, planKey: "essencial", actor: fakeActor() }),
      /courtesy_trial_days_invalid/
    );
    await assert.rejects(
      uc.execute({ companyId: "c-1", days: NaN, planKey: "essencial", actor: fakeActor() }),
      /courtesy_trial_days_invalid/
    );
  });

  it("execute(): propaga erro do RPC", async () => {
    const uc = new GrantCourtesyTrial(
      fakeRpc({ error: { message: "subscription_not_found" } }),
      new InMemoryNotifier()
    );
    await assert.rejects(
      uc.execute({ companyId: "c-1", days: 7, planKey: "essencial", actor: fakeActor() }),
      /subscription_not_found/
    );
  });

  it("execute(): publica evento de auditoria no sucesso", async () => {
    const notifier = new InMemoryNotifier();
    const uc = new GrantCourtesyTrial(fakeRpc(), notifier);
    await uc.execute({ companyId: "c-1", days: 7, planKey: "pro", actor: fakeActor() });
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "courtesy_trial_granted");
  });
});
