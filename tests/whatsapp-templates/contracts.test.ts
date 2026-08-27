import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubmitWhatsappTemplateBodySchema } from "@/src/domain/contracts/whatsappTemplates";

describe("WhatsappTemplates contracts", () => {
    it("aceita submit UTILITY válido", () => {
        const parsed = SubmitWhatsappTemplateBodySchema.safeParse({
            name: "pedido_saiu_entrega",
            language: "pt_BR",
            category: "UTILITY",
            bodyText: "Olá {{1}}! Pedido {{2}} saiu.",
            exampleBodyValues: ["Maria", "1042"],
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.name, "pedido_saiu_entrega");
            assert.equal(parsed.data.category, "UTILITY");
        }
    });

    it("rejeita nome com maiúsculas/espaços", () => {
        const parsed = SubmitWhatsappTemplateBodySchema.safeParse({
            name: "Pedido Saiu",
            bodyText: "oi",
        });
        assert.equal(parsed.success, false);
    });
});
