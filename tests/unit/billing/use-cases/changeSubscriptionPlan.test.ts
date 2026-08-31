/**
 * Teste do use case ChangeSubscriptionPlan.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BillingNotifierPort, BillingEvent } from "../../../../lib/billing/ports/billingNotifier";
import { ChangeSubscriptionPlan, type RpcExecutor } from "../../../../lib/billing/use-cases/changeSubscriptionPlan";
import { fakeActor } from "./_fakeActor";

function fakeRpc(error?: { message: string }): RpcExecutor {
  return async (_fn, _args) => ({ data: null, error: error ?? null });
}

class InMemoryNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];
  async publish(event: BillingEvent) { this.events.push(event); }
}

describe("ChangeSubscriptionPlan — validações + RPC + notifier", () => {
  it("execute(): chama RPC com args corretos", async () => {
    const captured: { fn: string; args: Record<string, unknown> } = { fn: "", args: {} };
    const rpc: RpcExecutor = async (fn, args) => {
      captured.fn = fn;
      captured.args = args;
      return { data: null, error: null };
    };
    const notifier = new InMemoryNotifier();
    const uc = new ChangeSubscriptionPlan(rpc, notifier);
    await uc.execute({ subscriptionId: "s-1", planKey: "market", reason: "upgrade", actor: fakeActor() });

    assert.strictEqual(captured.fn, "rpc_platform_change_subscription_plan");
    assert.strictEqual(captured.args.p_subscription_id, "s-1");
    assert.strictEqual(captured.args.p_plan_key, "market");
    assert.strictEqual(captured.args.p_reason, "upgrade");
    assert.strictEqual(captured.args.p_actor_id, "actor-1");
    assert.strictEqual(captured.args.p_actor_role, "superadmin");
    assert.strictEqual(captured.args.p_request_id, "req-1");
  });

  it("execute(): rejeita subscriptionId vazio", async () => {
    const uc = new ChangeSubscriptionPlan(fakeRpc(), new InMemoryNotifier());
    await assert.rejects(
      uc.execute({ subscriptionId: "", planKey: "essencial", actor: fakeActor() }),
      /subscriptionId required/
    );
  });

  it("execute(): rejeita planKey vazio", async () => {
    const uc = new ChangeSubscriptionPlan(fakeRpc(), new InMemoryNotifier());
    await assert.rejects(
      // @ts-expect-error: planKey vazio propositalmente
      uc.execute({ subscriptionId: "s-1", planKey: "", actor: fakeActor() }),
      /planKey required/
    );
  });

  it("execute(): propaga erro do RPC", async () => {
    const uc = new ChangeSubscriptionPlan(
      fakeRpc({ message: "plan_not_found" }),
      new InMemoryNotifier()
    );
    await assert.rejects(
      uc.execute({ subscriptionId: "s-1", planKey: "essencial", actor: fakeActor() }),
      /plan_not_found/
    );
  });

  it("execute(): publica evento de auditoria no sucesso", async () => {
    const notifier = new InMemoryNotifier();
    const uc = new ChangeSubscriptionPlan(fakeRpc(), notifier);
    await uc.execute({ subscriptionId: "s-1", planKey: "pro", actor: fakeActor() });
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "subscription_plan_changed");
    assert.strictEqual(notifier.events[0]?.subscriptionId, "s-1");
  });
});
