import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SubmitWhatsappTemplateBodySchema } from "@/src/domain/contracts/whatsappTemplates";
import { buildMetaTemplateComponents } from "@/lib/whatsapp-templates/submitTemplateToMeta";

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

    it("aceita header + botões (quick reply / url / phone)", () => {
        const parsed = SubmitWhatsappTemplateBodySchema.safeParse({
            name: "promo_fim_semana",
            category: "MARKETING",
            headerText: "Oferta {{1}}",
            headerExample: "Fim de semana",
            bodyText: "Oi {{1}}, confira as ofertas!",
            exampleBodyValues: ["João"],
            footerText: "Renthus",
            buttons: [
                { type: "QUICK_REPLY", text: "Quero ofertas" },
                { type: "URL", text: "Cardápio", url: "https://example.com/cardapio" },
                { type: "PHONE_NUMBER", text: "Ligar", phoneNumber: "+5565999999999" },
            ],
        });
        assert.equal(parsed.success, true);
    });

    it("exige headerExample quando header tem placeholder", () => {
        const parsed = SubmitWhatsappTemplateBodySchema.safeParse({
            name: "com_header",
            bodyText: "corpo",
            headerText: "Olá {{1}}",
        });
        assert.equal(parsed.success, false);
    });

    it("rejeita mais de um botão PHONE_NUMBER", () => {
        const parsed = SubmitWhatsappTemplateBodySchema.safeParse({
            name: "dois_fones",
            bodyText: "corpo",
            buttons: [
                { type: "PHONE_NUMBER", text: "A", phoneNumber: "+5565111111111" },
                { type: "PHONE_NUMBER", text: "B", phoneNumber: "+5565222222222" },
            ],
        });
        assert.equal(parsed.success, false);
    });

    it("buildMetaTemplateComponents monta HEADER/BODY/FOOTER/BUTTONS", () => {
        const components = buildMetaTemplateComponents({
            name: "pedido_saiu_entrega",
            language: "pt_BR",
            category: "UTILITY",
            headerText: "Pedido {{1}}",
            headerExample: "1042",
            bodyText: "Olá {{1}}!",
            exampleBodyValues: ["Maria"],
            footerText: "Loja",
            buttons: [
                { type: "QUICK_REPLY", text: "Ok" },
                {
                    type: "URL",
                    text: "Site",
                    url: "https://example.com",
                },
            ],
        });
        assert.equal(components[0]?.type, "HEADER");
        assert.equal(components[0]?.format, "TEXT");
        assert.deepEqual(
            (components[0]?.example as { header_text: string[] })?.header_text,
            ["1042"]
        );
        assert.equal(components[1]?.type, "BODY");
        assert.equal(components[2]?.type, "FOOTER");
        assert.equal(components[3]?.type, "BUTTONS");
        const buttons = components[3]?.buttons as Array<Record<string, unknown>>;
        assert.equal(buttons.length, 2);
        assert.equal(buttons[1]?.url, "https://example.com");
    });
});
