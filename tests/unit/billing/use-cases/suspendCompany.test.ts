/**
 * Teste do use case SuspendCompany.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BillingNotifierPort, BillingEvent } from "../../../../lib/billing/ports/billingNotifier";
import { SuspendCompany, type RpcExecutor } from "../../../../lib/billing/use-cases/suspendCompany";
import { fakeActor } from "./_fakeActor";

function fakeRpc(error?: { message: string }): RpcExecutor {
  return async (_fn, _args) => ({ data: null, error: error ?? null });
}

class InMemoryNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];
  async publish(event: BillingEvent) { this.events.push(event); }
}

describe("SuspendCompany — validações + RPC + notifier", () => {
  it("execute(): chama RPC com args corretos", async () => {
    const captured: { fn: string; args: Record<string, unknown> } = { fn: "", args: {} };
    const rpc: RpcExecutor = async (fn, args) => {
      captured.fn = fn;
      captured.args = args;
      return { data: null, error: null };
    };
    const uc = new SuspendCompany(rpc, new InMemoryNotifier());
    await uc.execute({ companyId: "c-1", reason: "trial_expired", actor: fakeActor() });

    assert.strictEqual(captured.fn, "rpc_platform_suspend_company");
    assert.strictEqual(captured.args.p_company_id, "c-1");
    assert.strictEqual(captured.args.p_reason, "trial_expired");
    assert.strictEqual(captured.args.p_actor_id, "actor-1");
    assert.strictEqual(captured.args.p_actor_role, "superadmin");
    assert.strictEqual(captured.args.p_request_id, "req-1");
  });

  it("execute(): rejeita companyId vazio", async () => {
    const uc = new SuspendCompany(fakeRpc(), new InMemoryNotifier());
    await assert.rejects(
      uc.execute({ companyId: "", actor: fakeActor() }),
      /companyId required/
    );
  });

  it("execute(): propaga erro do RPC", async () => {
    const uc = new SuspendCompany(
      fakeRpc({ message: "company_not_found" }),
      new InMemoryNotifier()
    );
    await assert.rejects(
      uc.execute({ companyId: "c-1", actor: fakeActor() }),
      /company_not_found/
    );
  });

  it("execute(): publica evento de auditoria no sucesso", async () => {
    const notifier = new InMemoryNotifier();
    const uc = new SuspendCompany(fakeRpc(), notifier);
    await uc.execute({ companyId: "c-1", reason: "manual", actor: fakeActor() });
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "company_suspended");
    assert.strictEqual(notifier.events[0]?.companyId, "c-1");
  });
});
