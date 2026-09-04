import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  neverPaidTenantToUi,
  subscriptionToUiRow,
} from "../../../../lib/billing/contracts/uiMappers";
import type { PagarmeSubscriptionWithLastInvoice } from "../../../../lib/billing/contracts/subscription";

function makeRow(
  overrides: Partial<PagarmeSubscriptionWithLastInvoice> = {}
): PagarmeSubscriptionWithLastInvoice {
  return {
    id: "s-1",
    companyId: "c-1",
    planKey: "essencial",
    planId: "p-1",
    status: "active",
    allowOverage: false,
    trialEndsAt: null,
    lastPaidAt: null,
    nextBillingAt: null,
    activatedAt: null,
    startedAt: null,
    companyName: "Ferrester",
    companySlug: "ferrester",
    companyIsActive: true,
    companyEmail: "paulo@example.com",
    planName: "Essencial",
    planPriceCents: 27900,
    lastInvoiceId: null,
    lastInvoiceAmount: null,
    lastInvoiceStatus: null,
    lastInvoiceDueAt: null,
    lastInvoicePaidAt: null,
    ...overrides,
  };
}

describe("uiMappers — platform billing lists", () => {
  it("subscriptionToUiRow: usa companyName/email flat (não depende de embed)", () => {
    const ui = subscriptionToUiRow(makeRow());
    assert.strictEqual(ui.company?.name, "Ferrester");
    assert.strictEqual(ui.company?.email, "paulo@example.com");
    assert.strictEqual(ui.plan?.name, "Essencial");
    assert.strictEqual(ui.plan?.key, "essencial");
  });

  it("neverPaidTenantToUi: mapeia email e plan/status", () => {
    const ui = neverPaidTenantToUi({
      ...makeRow({ status: "pending_payment", planKey: "pro", planName: "Pro" }),
      pendingInvoice: null,
    });
    assert.strictEqual(ui.companyName, "Ferrester");
    assert.strictEqual(ui.email, "paulo@example.com");
    assert.strictEqual(ui.plan, "Pro");
    assert.strictEqual(ui.billingStatus, "pending_payment");
  });
});
