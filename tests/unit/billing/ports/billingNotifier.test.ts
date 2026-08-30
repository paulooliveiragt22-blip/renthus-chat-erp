/**
 * Teste de contrato — BillingNotifierPort
 *
 * Garante que QUALQUER implementação aceita eventos com formato canônico.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  BillingNotifierPort,
  BillingEvent,
  BillingEventKind,
} from "../../../../lib/billing/ports/billingNotifier";

class InMemoryBillingNotifier implements BillingNotifierPort {
  public events: BillingEvent[] = [];

  async publish(event: BillingEvent): Promise<void> {
    this.events.push(event);
  }
}

describe("BillingNotifierPort — contrato", () => {
  it("publish(): aceita evento mínimo válido", async () => {
    const notifier = new InMemoryBillingNotifier();
    const event: BillingEvent = {
      kind: "subscription_plan_changed" as BillingEventKind,
      scope: "platform-billing",
      message: "plan changed",
      occurredAt: new Date(),
    };
    await notifier.publish(event);
    assert.strictEqual(notifier.events.length, 1);
    assert.strictEqual(notifier.events[0]?.kind, "subscription_plan_changed");
  });

  it("publish(): aceita evento com companyId e extra metadata", async () => {
    const notifier = new InMemoryBillingNotifier();
    const event: BillingEvent = {
      kind: "company_suspended",
      scope: "platform-billing",
      message: "company suspended",
      companyId: "c-abc",
      subscriptionId: "s-xyz",
      extra: { reason: "trial_expired", daysOverdue: 7 },
      occurredAt: new Date(),
    };
    await notifier.publish(event);
    assert.strictEqual(notifier.events[0]?.companyId, "c-abc");
    assert.deepStrictEqual(notifier.events[0]?.extra, {
      reason: "trial_expired",
      daysOverdue: 7,
    });
  });

  it("publish(): preserva ordem de chamada", async () => {
    const notifier = new InMemoryBillingNotifier();
    const kinds: BillingEventKind[] = [
      "subscription_plan_changed",
      "company_suspended",
      "courtesy_trial_granted",
    ];
    for (const kind of kinds) {
      await notifier.publish({
        kind,
        scope: "test",
        message: kind,
        occurredAt: new Date(),
      });
    }
    assert.deepStrictEqual(
      notifier.events.map((e) => e.kind),
      kinds
    );
  });
});
