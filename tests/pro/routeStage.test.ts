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
    const webMenuUrl = "https://app.renthus.com.br/c/loja?utm_source=whatsapp&wm=long";
    const webMenuOrdersUrl =
        "https://app.renthus.com.br/c/loja?utm_source=whatsapp&wm=short&orders=1";

    it("status (btn_status) envia CTA Meus pedidos com ?orders=1", () => {
        const out = routeStage({
            state: idle(),
            decision: decision("status_intent"),
            inboundText: "btn_status",
            tenant,
            webMenuUrl,
            webMenuOrdersUrl,
        });
        assert.equal(out.mode, "direct_reply");
        const cta = out.outbound.find((m) => m.kind === "cta_url");
        assert.ok(cta);
        assert.equal(cta?.ctaUrl?.displayText, "Meus pedidos");
        assert.ok(cta?.ctaUrl?.url.includes("orders=1"));
        assert.equal(cta?.ctaUrl?.url, webMenuOrdersUrl);
    });

    it("prefill wa.me (Ver meus pedidos) envia CTA com link curto", () => {
        const out = routeStage({
            state: idle(),
            decision: decision("unknown"),
            inboundText: "Ver meus pedidos",
            tenant,
            webMenuUrl,
            webMenuOrdersUrl,
        });
        const cta = out.outbound.find((m) => m.kind === "cta_url");
        assert.ok(cta);
        assert.equal(cta?.ctaUrl?.url, webMenuOrdersUrl);
    });

    it("catálogo (btn_catalog) envia CTA do cardápio", () => {
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
    });
});
