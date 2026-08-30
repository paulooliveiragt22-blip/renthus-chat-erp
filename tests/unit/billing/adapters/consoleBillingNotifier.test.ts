/**
 * Teste do ConsoleBillingNotifier.
 *
 * Captura console.log e verifica formato: [billing:<scope>] <message> {json}
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  ConsoleBillingNotifier,
  consoleBillingNotifier,
} from "../../../../lib/billing/adapters/consoleBillingNotifier";
import type { BillingEvent } from "../../../../lib/billing/ports/billingNotifier";

describe("ConsoleBillingNotifier", () => {
  let captured: string[] = [];
  let originalLog: typeof console.log;

  beforeEach(() => {
    captured = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it("publish(): emite linha formatada [billing:scope]", async () => {
    const notifier = new ConsoleBillingNotifier();
    const event: BillingEvent = {
      kind: "subscription_plan_changed",
      scope: "platform-billing",
      message: "plan changed",
      occurredAt: new Date("2026-04-01T10:00:00Z"),
    };
    await notifier.publish(event);
    assert.strictEqual(captured.length, 1);
    assert.ok(captured[0]!.startsWith("[billing:platform-billing] plan changed "));
  });

  it("publish(): inclui companyId/subscriptionId/extra no JSON", async () => {
    const notifier = new ConsoleBillingNotifier();
    await notifier.publish({
      kind: "company_suspended",
      scope: "platform-billing",
      message: "company suspended",
      companyId: "c-abc",
      subscriptionId: "s-xyz",
      extra: { reason: "trial_expired" },
      occurredAt: new Date("2026-04-01T10:00:00Z"),
    });
    const line = captured[0]!;
    assert.ok(line.includes("c-abc"));
    assert.ok(line.includes("s-xyz"));
    assert.ok(line.includes("trial_expired"));
  });

  it("consoleBillingNotifier: singleton exportado", () => {
    assert.ok(consoleBillingNotifier instanceof ConsoleBillingNotifier);
  });

  it("publish(): omite campos undefined do JSON", async () => {
    const notifier = new ConsoleBillingNotifier();
    await notifier.publish({
      kind: "checkout_ensured",
      scope: "billing",
      message: "ready",
      occurredAt: new Date("2026-04-01T10:00:00Z"),
    });
    const line = captured[0]!;
    // Não deve ter companyId nem subscriptionId
    assert.ok(!line.includes("companyId"));
    assert.ok(!line.includes("subscriptionId"));
  });
});
