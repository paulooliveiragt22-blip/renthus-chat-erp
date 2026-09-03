import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildAiDegradedOutbound,
    profileFromCapabilityGates,
    shouldOfferWebMenuOnAiDegraded,
} from "../../lib/chatbot/aiCapabilityProfile";

describe("aiCapabilityProfile — D6 degradedReason (C1c)", () => {
    it("sem plano → no_subscription e não oferece cardápio", () => {
        const p = profileFromCapabilityGates({
            planKey: null,
            aiEnabled: true,
            canUseAi: true,
        });
        assert.equal(p.tier, "degradado");
        assert.equal(p.llmEnabled, false);
        assert.equal(p.degradedReason, "no_subscription");
        assert.equal(shouldOfferWebMenuOnAiDegraded(p.degradedReason), false);
    });

    it("IA desligada → ai_disabled e oferece cardápio", () => {
        const p = profileFromCapabilityGates({
            planKey: "pro",
            aiEnabled: false,
            canUseAi: true,
        });
        assert.equal(p.degradedReason, "ai_disabled");
        assert.equal(shouldOfferWebMenuOnAiDegraded(p.degradedReason), true);
    });

    it("crédito vazio → ai_wallet_empty e oferece cardápio", () => {
        const p = profileFromCapabilityGates({
            planKey: "essencial",
            aiEnabled: true,
            canUseAi: false,
        });
        assert.equal(p.tier, "degradado");
        assert.equal(p.degradedReason, "ai_wallet_empty");
        assert.equal(shouldOfferWebMenuOnAiDegraded(p.degradedReason), true);
    });

    it("erro de leitura de gates → profile_resolve_error (não no_subscription)", () => {
        const p = profileFromCapabilityGates({
            planKey: null,
            aiEnabled: true,
            canUseAi: false,
            resolveError: true,
        });
        assert.equal(p.degradedReason, "profile_resolve_error");
        assert.equal(shouldOfferWebMenuOnAiDegraded(p.degradedReason), true);
    });

    it("gates ok → basico/avancado sem degradedReason", () => {
        const basico = profileFromCapabilityGates({
            planKey: "essencial",
            aiEnabled: true,
            canUseAi: true,
        });
        assert.equal(basico.tier, "basico");
        assert.equal(basico.llmEnabled, true);
        assert.equal(basico.degradedReason, null);

        const avancado = profileFromCapabilityGates({
            planKey: "pro",
            aiEnabled: true,
            canUseAi: true,
        });
        assert.equal(avancado.tier, "avancado");
        assert.equal(avancado.degradedReason, null);
    });

    it("buildAiDegradedOutbound: wallet empty → texto + cta_url", () => {
        const out = buildAiDegradedOutbound({
            webMenuUrl: "https://loja.example/c/demo",
            reason: "ai_wallet_empty",
        });
        assert.equal(out.length, 2);
        assert.equal(out[0]?.kind, "text");
        assert.equal(out[1]?.kind, "cta_url");
        const url = out[1]?.ctaUrl?.url ?? "";
        const display = out[1]?.ctaUrl?.displayText ?? "";
        assert.equal(url, "https://loja.example/c/demo");
        assert.match(display, /cardápio/i);
    });

    it("buildAiDegradedOutbound: no_subscription → só texto, sem CTA web", () => {
        const out = buildAiDegradedOutbound({
            webMenuUrl: "https://loja.example/c/demo",
            reason: "no_subscription",
        });
        assert.equal(out.length, 1);
        assert.equal(out[0]?.kind, "text");
        assert.ok(!out.some((m) => m.kind === "cta_url"));
        const text = out[0]?.text ?? "";
        assert.match(text, /indisponível/i);
        assert.ok(!/https:\/\//.test(text));
    });

    it("buildAiDegradedOutbound: llm_error sem URL → texto com dica cardápio", () => {
        const out = buildAiDegradedOutbound({ reason: "llm_error" });
        assert.equal(out.length, 1);
        assert.equal(out[0]?.kind, "text");
    });
});
