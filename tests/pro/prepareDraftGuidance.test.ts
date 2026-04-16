import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrepareDraftGuidanceForModel } from "../../lib/chatbot/pro/prepareOrderDraft";

describe("buildPrepareDraftGuidanceForModel", () => {
    it("quando ok, orienta alinhamento ao draft", () => {
        const g = buildPrepareDraftGuidanceForModel(true, []);
        assert.ok(g.some((l) => l.toLowerCase().includes("aceito")));
        assert.ok(g.some((l) => l.toLowerCase().includes("draft")));
    });

    it("quando falta pagamento, sugere próximo passo de payment_method", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ["Informe payment_method: pix, cash ou card."]);
        assert.ok(g.some((l) => l.includes("payment_method")));
        assert.ok(g.some((l) => l.toLowerCase().includes("próximo passo")));
    });

    it("quando estoque, sugere quantidade menor", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ['Estoque insuficiente para "X" (pediu 2).']);
        assert.ok(g.some((l) => l.toLowerCase().includes("estoque")));
    });
});
