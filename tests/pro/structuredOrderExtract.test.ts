import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { extractOrderLinesStructured } from "../../src/pro/replay/structuredOrderExtract";

function mockModelWithText(text: string): MockLanguageModelV3 {
    return new MockLanguageModelV3({
        doGenerate: async () => ({
            content: [{ type: "text", text }],
            finishReason: { unified: "stop", raw: undefined },
            usage: {
                inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 20, text: 20, reasoning: undefined },
            },
            warnings: [],
        }),
    });
}

describe("extractOrderLinesStructured", () => {
    it("texto vazio não chama o modelo e devolve null", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                throw new Error("não deve chamar o modelo para texto vazio");
            },
        });
        const out = await extractOrderLinesStructured({ userText: "   ", modelOverride: model });
        assert.equal(out, null);
    });

    it("parseia JSON válido devolvido pelo modelo", async () => {
        const model = mockModelWithText(
            '{"v":1,"items":[{"searchTerm":"heineken long neck","quantity":2}],"paymentMethod":"pix"}'
        );
        const out = await extractOrderLinesStructured({
            userText: "quero 2 heineken long neck no pix",
            modelOverride: model,
        });
        assert.ok(out);
        assert.equal(out!.items[0]?.searchTerm, "heineken long neck");
        assert.equal(out!.items[0]?.quantity, 2);
        assert.equal(out!.paymentMethod, "pix");
    });

    it("tolera cerca de markdown e aliases PT-BR (parser existente, não Output.object)", async () => {
        const model = mockModelWithText(
            '```json\n{"v":1,"itens":[{"search_term":"skol lata","quantidade":1}],"dialogo":null}\n```'
        );
        const out = await extractOrderLinesStructured({ userText: "quero uma skol lata", modelOverride: model });
        assert.ok(out);
        assert.equal(out!.items[0]?.searchTerm, "skol lata");
    });

    it("JSON inválido (pergunta sem pedido) devolve null sem lançar", async () => {
        const model = mockModelWithText("não é bem uma extração de pedido válida");
        const out = await extractOrderLinesStructured({ userText: "tem coca 2l?", modelOverride: model });
        assert.equal(out, null);
    });

    it("erro do modelo devolve null (fallback silencioso)", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                throw new Error("simulated provider error");
            },
        });
        const out = await extractOrderLinesStructured({ userText: "quero 2 skol", modelOverride: model });
        assert.equal(out, null);
    });
});
