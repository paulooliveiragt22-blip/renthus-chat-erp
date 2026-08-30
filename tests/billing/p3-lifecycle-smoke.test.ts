import assert from "node:assert";
import { describe, it } from "node:test";
import { billingInactiveMessage, isBillingAccessAllowed, resolveEffectiveBillingStatus } from "../../lib/billing/resolveBillingAccess";
import { resolveInboundFromSnapshots } from "../../lib/billing/canProcessInboundChannel";

const NOW = new Date("2026-08-28T15:00:00.000Z");

function pendingSetupSub() {
  return { status: "pending_setup", trial_ends_at: null, last_paid_at: null, plan: null, created_at: "2026-08-14T10:00:00.000Z" } as const;
}
function pendingPaymentSub() {
  return { status: "pending_payment", trial_ends_at: null, last_paid_at: null, plan: "pro", created_at: "2026-08-14T10:00:00.000Z" } as const;
}
function abandonedSub() {
  return { status: "abandoned", trial_ends_at: null, last_paid_at: null, plan: "pro", created_at: "2026-08-14T10:00:00.000Z", abandoned_at: NOW.toISOString() } as const;
}
function reactivatedSub() {
  return { status: "trial", trial_ends_at: new Date(NOW.getTime() + 7 * 86400000).toISOString(), last_paid_at: null, plan: "pro", abandoned_at: null, self_reactivation_count: 1 } as any;
}

// Etapa 1: pending_setup bloqueia API
describe("P3-1 pending_setup", () => {
  it("effective status is pending_setup", () => {
    assert.equal(resolveEffectiveBillingStatus(pendingSetupSub(), NOW), "pending_setup");
  });
  it("API full blocked", () => {
    assert.equal(isBillingAccessAllowed("pending_setup", "full"), false);
  });
  it("inbound blocked (not abandoned)", () => {
    assert.equal(resolveInboundFromSnapshots(false, pendingSetupSub(), NOW).allowed, false);
  });
  it("billingInactiveMessage links to /plano/pagar", () => {
    assert.match(billingInactiveMessage("pending_setup"), /plano/i);
  });
});

// Etapa 2: Cron mark-abandoned cutoff
describe("P3-2 mark-abandoned cutoff", () => {
  it("14d old sub is stale", () => {
    const cutoff = new Date(NOW.getTime() - 14 * 86400000);
    assert.equal(new Date(pendingSetupSub().created_at).getTime() <= cutoff.getTime(), true);
  });
  it("13d old sub is NOT stale", () => {
    const cutoff = new Date(NOW.getTime() - 14 * 86400000);
    const sub = { ...pendingSetupSub(), created_at: new Date(NOW.getTime() - 13 * 86400000).toISOString() };
    assert.equal(new Date(sub.created_at).getTime() <= cutoff.getTime(), false);
  });
});

// Etapa 3: abandoned
describe("P3-3 abandoned lifecycle", () => {
  it("effective status is abandoned", () => {
    assert.equal(resolveEffectiveBillingStatus(abandonedSub(), NOW), "abandoned");
  });
  it("API full STILL blocked in abandoned", () => {
    assert.equal(isBillingAccessAllowed("abandoned", "full"), false);
  });
  it("inbound ALLOWED with autoReply=reactivation (is_active=false)", () => {
    const gate = resolveInboundFromSnapshots(false, abandonedSub(), NOW);
    assert.equal(gate.allowed, true);
    const ar = "autoReply" in gate ? (gate as any).autoReply : null;
    assert.equal(ar, "reactivation");
  });
  it("inbound blocked for blocked/cancelled status", () => {
    for (const s of [{ status: "blocked" }, { status: "cancelled" }]) {
      const sub = { ...pendingSetupSub(), ...s } as any;
      assert.equal(resolveInboundFromSnapshots(true, sub, NOW).allowed, false, `status=${s.status} should block`);
    }
  });
  it("active allows inbound (LLM, no autoReply)", () => {
    const sub = { status: "active", trial_ends_at: null, last_paid_at: NOW.toISOString(), plan: "pro" } as any;
    const gate = resolveInboundFromSnapshots(true, sub, NOW);
    assert.equal(gate.allowed, true);
    const ar = "autoReply" in gate ? (gate as any).autoReply : null;
    assert.equal(ar, null);
  });
  it("billingInactiveMessage(abandoned) links to /plano/reativar", () => {
    assert.match(billingInactiveMessage("abandoned"), /\/plano\/reativar/);
  });
  it("abandoned with is_active=true still autoReply (defensive)", () => {
    const gate = resolveInboundFromSnapshots(true, abandonedSub(), NOW);
    assert.equal(gate.allowed, true);
    const ar = "autoReply" in gate ? (gate as any).autoReply : null;
    assert.equal(ar, "reactivation");
  });
});

// Etapa 4: self-reactivate
describe("P3-4 self-reactivate", () => {
  it("reactivated sub is trial with future trial_ends_at", () => {
    assert.equal(resolveEffectiveBillingStatus(reactivatedSub(), NOW), "trial");
  });
  it("reactivated trial grants full access", () => {
    assert.equal(isBillingAccessAllowed("trial", "full"), true);
  });
  it("reactivated trial processes via LLM (no autoReply)", () => {
    const gate = resolveInboundFromSnapshots(true, reactivatedSub(), NOW);
    assert.equal(gate.allowed, true);
    const ar = "autoReply" in gate ? (gate as any).autoReply : null;
    assert.equal(ar, null);
  });
});
