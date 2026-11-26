import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linksFrom } from "../../src/service/adapters/site/siteChatRpc";
import { priorTurnsFromRows } from "../../src/service/adapters/whatsapp/priorTurns";
import { sanitizeModelError } from "../../src/service/domain/modelError";
import { toServiceModelMessages } from "../../src/service/domain/modelMessages";
import { siteChatPageUrl } from "../../src/service/domain/siteChat";
import { siteChatPostSchema } from "../../src/service/http/schemas";

describe("chat do site", () => {
    it("manda o histórico como mensagens e recusa o id da empresa", () => {
        const messages = toServiceModelMessages(
            [
                { role: "user", text: "quanto custa" },
                { role: "assistant", text: "O Essencial está descrito na oferta." },
            ],
            "e o Pro?",
            "do site"
        );
        assert.equal(messages.length, 3);
        assert.match(messages[0]?.content ?? "", /<customer_message>/u);
        assert.match(messages[0]?.content ?? "", /quanto custa/u);
        assert.equal(messages[1]?.role, "assistant");
        assert.equal(siteChatPostSchema.safeParse({ text: "oi", companyId: "x" }).success, false);
        assert.equal(siteChatPostSchema.safeParse({ text: "oi", key: "0113a3fe-e224-49ff-81c6-f8b9df556267" }).success, true);
        assert.equal(siteChatPageUrl("0113a3fe-e224-49ff-81c6-f8b9df556267"), "https://www.zampell.com.br/chat/0113a3fe-e224-49ff-81c6-f8b9df556267");
    });

    it("o WhatsApp lembra as últimas falas e esconde a mensagem atual", () => {
        const turns = priorTurnsFromRows(
            [
                { id: "old", direction: "inbound", body: "oi" },
                { id: "bot", direction: "outbound", body: "olá" },
                { id: "now", direction: "inbound", body: "quero horário" },
            ],
            "now"
        );
        assert.deepEqual(turns, [
            { role: "user", text: "oi" },
            { role: "assistant", text: "olá" },
        ]);
    });

    it("o erro do modelo não leva a chave", () => {
        const text = sanitizeModelError(new Error("bad sk-ant-api03-secret key"));
        assert.match(text, /\[key\]/u);
        assert.equal(text.includes("secret"), false);
    });

    it("só devolve link https com rótulo conhecido", () => {
        const links = linksFrom([
            { label: "Ver plano", url: "https://zampell.com.br/pro" },
            { label: "Ver plano", url: "http://zampell.com.br/pro" },
            { label: "Clique", url: "https://zampell.com.br/x" },
        ]);
        assert.deepEqual(links, [{ label: "Ver plano", url: "https://zampell.com.br/pro" }, { label: "Ver oferta", url: "https://zampell.com.br/x" }]);
    });
});
