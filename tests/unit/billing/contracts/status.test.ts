/**
 * Testes unitários para lib/billing/contracts/status.ts
 *
 * Cobre:
 *  - isPaid / isBlocking / isActiveTrial (smoke)
 *  - isNeverPaid: matriz completa 8 status × cenários
 *  - type guards (isPagarmeSubStatus / isPagarmeInvoiceStatus / isSubscriptionPlanKey)
 *
 * Helpers são puros (sem I/O) — testáveis sem mocks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PAGARME_SUB_STATUSES,
  PAGARME_INVOICE_STATUSES,
  SUBSCRIPTION_PLAN_KEYS,
  PAID_STATUSES,
  BLOCKING_STATUSES,
  NEEDS_PAYMENT_STATUSES,
  NEVER_PAID_STATUSES,
  TRIAL_STATUSES,
  isPaid,
  isBlocking,
  isActiveTrial,
  isNeverPaid,
  isPagarmeSubStatus,
  isPagarmeInvoiceStatus,
  isSubscriptionPlanKey,
  type PagarmeSubStatus,
} from "../../../../lib/billing/contracts/status";

describe("billing/contracts/status — constants", () => {
  it("PAGARME_SUB_STATUSES tem 8 valores canônicos", () => {
    assert.strictEqual(PAGARME_SUB_STATUSES.length, 8);
    assert.deepStrictEqual(
      [...PAGARME_SUB_STATUSES].sort(),
      [
        "abandoned",
        "active",
        "blocked",
        "cancelled",
        "overdue",
        "pending_payment",
        "pending_setup",
        "trial",
      ].sort()
    );
  });

  it("PAGARME_INVOICE_STATUSES tem 4 valores", () => {
    assert.strictEqual(PAGARME_INVOICE_STATUSES.length, 4);
  });

  it("SUBSCRIPTION_PLAN_KEYS tem 3 valores comerciais (sem aliases bot/complete)", () => {
    assert.strictEqual(SUBSCRIPTION_PLAN_KEYS.length, 3);
    assert.deepEqual([...SUBSCRIPTION_PLAN_KEYS], ["essencial", "pro", "market"]);
  });

  it("agrupamentos paid/blocking/needs_payment não se sobrepõem", () => {
    const overlap = PAID_STATUSES.filter((s) =>
      (BLOCKING_STATUSES as readonly string[]).includes(s)
    );
    assert.strictEqual(overlap.length, 0);
    const overlap2 = PAID_STATUSES.filter((s) =>
      (NEEDS_PAYMENT_STATUSES as readonly string[]).includes(s)
    );
    assert.strictEqual(overlap2.length, 0);
    assert.strictEqual(TRIAL_STATUSES.length, 1);
  });
});

describe("billing/contracts/status — isPaid", () => {
  it("true apenas para 'active'", () => {
    assert.strictEqual(isPaid("active"), true);
  });

  it("false para os outros 7 status", () => {
    const others = PAGARME_SUB_STATUSES.filter((s) => s !== "active");
    for (const s of others) {
      assert.strictEqual(isPaid(s as PagarmeSubStatus), false);
    }
  });
});

describe("billing/contracts/status — isBlocking", () => {
  it("true para blocked e cancelled", () => {
    assert.strictEqual(isBlocking("blocked"), true);
    assert.strictEqual(isBlocking("cancelled"), true);
  });

  it("false para active, trial, overdue e never-paid statuses", () => {
    for (const s of ["active", "trial", "overdue", "pending_payment", "pending_setup", "abandoned"] as const) {
      assert.strictEqual(isBlocking(s), false);
    }
  });
});

describe("billing/contracts/status — isActiveTrial", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 1 * 86_400_000).toISOString();

  it("true: trial + trial_ends_at no futuro", () => {
    assert.strictEqual(isActiveTrial("trial", FUTURE), true);
  });

  it("false: trial + trial_ends_at no passado", () => {
    assert.strictEqual(isActiveTrial("trial", PAST), false);
  });

  it("false: trial + trial_ends_at null", () => {
    assert.strictEqual(isActiveTrial("trial", null), false);
  });

  it("false: status !== trial, mesmo com trial_ends_at no futuro", () => {
    assert.strictEqual(isActiveTrial("active", FUTURE), false);
    assert.strictEqual(isActiveTrial("pending_payment", FUTURE), false);
  });
});

describe("billing/contracts/status — isNeverPaid (matriz)", () => {
  const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 1 * 86_400_000).toISOString();

  const matrix: Array<{
    status: PagarmeSubStatus;
    lastPaid: string | null;
    trial: string | null;
    expected: boolean;
  }> = [
    { status: "pending_payment", lastPaid: null, trial: null, expected: true },
    { status: "pending_payment", lastPaid: null, trial: PAST, expected: true },
    { status: "pending_payment", lastPaid: "2026-01-01T00:00:00Z", trial: PAST, expected: true },
    { status: "pending_setup", lastPaid: null, trial: null, expected: true },
    { status: "abandoned", lastPaid: null, trial: null, expected: true },
    { status: "trial", lastPaid: null, trial: FUTURE, expected: false },
    { status: "trial", lastPaid: "2026-01-01T00:00:00Z", trial: FUTURE, expected: false },
    { status: "trial", lastPaid: null, trial: PAST, expected: true },
    { status: "trial", lastPaid: "2026-01-01T00:00:00Z", trial: PAST, expected: false },
    { status: "trial", lastPaid: null, trial: null, expected: false },
    { status: "active", lastPaid: null, trial: null, expected: false },
    { status: "active", lastPaid: "2026-01-01T00:00:00Z", trial: null, expected: false },
    { status: "overdue", lastPaid: null, trial: null, expected: false },
    { status: "blocked", lastPaid: null, trial: null, expected: false },
    { status: "cancelled", lastPaid: null, trial: null, expected: false },
  ];

  for (const c of matrix) {
    const label = `status=${c.status} lastPaid=${c.lastPaid ?? "null"} trial=${c.trial ?? "null"}`;
    it(label, () => {
      const got = isNeverPaid({
        status: c.status,
        last_paid_at: c.lastPaid,
        trial_ends_at: c.trial,
      });
      assert.strictEqual(got, c.expected);
    });
  }
});

describe("billing/contracts/status — NEVER_PAID_STATUSES composição", () => {
  it("inclui pending_payment, pending_setup, abandoned", () => {
    assert.ok((NEVER_PAID_STATUSES as readonly string[]).includes("pending_payment"));
    assert.ok((NEVER_PAID_STATUSES as readonly string[]).includes("pending_setup"));
    assert.ok((NEVER_PAID_STATUSES as readonly string[]).includes("abandoned"));
  });

  it("NÃO inclui overdue (já pagou mas venceu; é cobrança, não never-paid)", () => {
    assert.ok(!(NEVER_PAID_STATUSES as readonly string[]).includes("overdue"));
  });

  it("NÃO inclui active, blocked, cancelled, trial", () => {
    for (const s of ["active", "blocked", "cancelled", "trial"] as const) {
      assert.ok(!(NEVER_PAID_STATUSES as readonly string[]).includes(s));
    }
  });
});

describe("billing/contracts/status — type guards", () => {
  describe("isPagarmeSubStatus", () => {
    it("true para cada um dos 8 valores canônicos", () => {
      for (const s of PAGARME_SUB_STATUSES) {
        assert.strictEqual(isPagarmeSubStatus(s), true);
      }
    });

    it("false para inválidos (string vazia, outros, null, undefined, number, object)", () => {
      assert.strictEqual(isPagarmeSubStatus("foo"), false);
      assert.strictEqual(isPagarmeSubStatus(""), false);
      assert.strictEqual(isPagarmeSubStatus(null), false);
      assert.strictEqual(isPagarmeSubStatus(undefined), false);
      assert.strictEqual(isPagarmeSubStatus(123), false);
      assert.strictEqual(isPagarmeSubStatus({}), false);
    });
  });

  describe("isPagarmeInvoiceStatus", () => {
    it("true para os 4 valores canônicos", () => {
      for (const s of PAGARME_INVOICE_STATUSES) {
        assert.strictEqual(isPagarmeInvoiceStatus(s), true);
      }
    });

    it("false para inválidos", () => {
      assert.strictEqual(isPagarmeInvoiceStatus("refunded"), false);
      assert.strictEqual(isPagarmeInvoiceStatus(null), false);
    });
  });

  describe("isSubscriptionPlanKey", () => {
    it("true para os 5 valores canônicos", () => {
      for (const s of SUBSCRIPTION_PLAN_KEYS) {
        assert.strictEqual(isSubscriptionPlanKey(s), true);
      }
    });

    it("false para inválidos (case-sensitive)", () => {
      assert.strictEqual(isSubscriptionPlanKey("premium"), false);
      assert.strictEqual(isSubscriptionPlanKey("bot"), false);
      assert.strictEqual(isSubscriptionPlanKey("complete"), false);
      assert.strictEqual(isSubscriptionPlanKey("ESSENCIAL"), false);
      assert.strictEqual(isSubscriptionPlanKey(null), false);
    });
  });
});