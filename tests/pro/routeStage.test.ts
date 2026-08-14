import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeStage } from "../../src/pro/pipeline/stages/routeStage";
import type { IntentDecision, ProSessionState, TenantRef } from "../../src/types/contracts";

const tenant: TenantRef = {
    companyId: "c1",
    threadId: "t1",
    messageId: "m1",
    phoneE164: "+5511999999999",
};

function idle(): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

function decision(intent: IntentDecision["intent"]): IntentDecision {
    return { intent, confidence: "high", reasonCode: "button_id_match" };
}

describe("routeStage F5 web menu", () => {
    const webMenuUrl = "https://app.renthus.com.br/c/loja?utm_source=whatsapp";

    it("status (btn_status) envia CTA Meus pedidos com ?orders=1", () => {
        const out = routeStage({
            state: idle(),
            decision: decision("status_intent"),
            inboundText: "btn_status",
            tenant,
            webMenuUrl,
        });
        assert.equal(out.mode, "direct_reply");
        const cta = out.outbound.find((m) => m.kind === "cta_url");
        assert.ok(cta);
        assert.equal(cta?.ctaUrl?.displayText, "Meus pedidos");
        assert.ok(cta?.ctaUrl?.url.includes("orders=1"));
        assert.ok(cta?.ctaUrl?.url.includes("utm_source=whatsapp"));
        assert.ok(out.outbound.every((m) => m.kind !== "flow"));
    });

    it("catálogo (btn_catalog) envia CTA do cardápio sem Flow", () => {
        const out = routeStage({
            state: idle(),
            decision: decision("order_intent"),
            inboundText: "btn_catalog",
            tenant,
            webMenuUrl,
        });
        const cta = out.outbound.find((m) => m.kind === "cta_url");
        assert.ok(cta);
        assert.equal(cta?.ctaUrl?.displayText, "Abrir cardápio");
        assert.equal(cta?.ctaUrl?.url, webMenuUrl);
        assert.ok(out.outbound.every((m) => m.kind !== "flow"));
    });
});
