import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    estimateSttCostBrlCents,
    estimateSttDurationFromBytes,
    normalizeSttDurationSec,
    sttCostExamplesBrl,
    sttUsdPerMinute,
} from "@/lib/billing/sttPricing";

describe("sttPricing", () => {
    it("usa preços oficiais OpenAI ($/min)", () => {
        assert.equal(sttUsdPerMinute("whisper-1"), 0.006);
        assert.equal(sttUsdPerMinute("gpt-4o-transcribe"), 0.006);
        assert.equal(sttUsdPerMinute("gpt-4o-mini-transcribe"), 0.003);
        assert.equal(sttUsdPerMinute("gpt-transcribe"), 0.0045);
        assert.equal(sttUsdPerMinute("modelo-desconhecido"), 0.006);
    });

    it("normaliza duração com mínimo 1s e ceil", () => {
        assert.equal(normalizeSttDurationSec(0), 1);
        assert.equal(normalizeSttDurationSec(-3), 1);
        assert.equal(normalizeSttDurationSec(1.1), 2);
        assert.equal(normalizeSttDurationSec(20), 20);
    });

    it("estima duração a partir de bytes Opus ~16kbps", () => {
        // 40_000 bytes / 2000 = 20s
        assert.equal(estimateSttDurationFromBytes(40_000), 20);
        assert.equal(estimateSttDurationFromBytes(100), 1);
    });

    it("calcula centavos BRL com câmbio 5.5 (ceil, mín. 1)", () => {
        // 1s whisper: (1/60)*0.006*5.5*100 = 0.055 → ceil 1 cent
        assert.equal(estimateSttCostBrlCents("whisper-1", 1, 5.5), 1);

        // 20s whisper: (20/60)*0.006*5.5*100 = 1.1 → ceil 2 centavos
        assert.equal(estimateSttCostBrlCents("whisper-1", 20, 5.5), 2);

        // 60s whisper: 0.006*5.5*100 = 3.3 → ceil 4 centavos
        assert.equal(estimateSttCostBrlCents("whisper-1", 60, 5.5), 4);

        // 60s mini: 0.003*5.5*100 = 1.65 → ceil 2 centavos
        assert.equal(estimateSttCostBrlCents("gpt-4o-mini-transcribe", 60, 5.5), 2);

        // 60s gpt-4o-transcribe: igual whisper
        assert.equal(estimateSttCostBrlCents("gpt-4o-transcribe", 60, 5.5), 4);
    });

    it("exemplos de ordem de grandeza", () => {
        const ex = sttCostExamplesBrl("gpt-4o-transcribe", 5.5);
        assert.equal(ex.perSecondCents, 1);
        assert.equal(ex.per20sCents, 2);
        assert.equal(ex.perMinuteCents, 4);
    });
});
