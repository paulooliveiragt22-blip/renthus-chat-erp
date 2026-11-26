import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linksFrom } from "../../src/service/adapters/site/siteChatRpc";
import { formatPriorTurns } from "../../src/service/domain/siteChat";
import { siteChatPostSchema } from "../../src/service/http/schemas";

describe("chat do site", () => {
    it("guarda o histórico como dado e recusa corpo solto", () => {
        const block = formatPriorTurns([
            { role: "user", text: "quanto custa" },
            { role: "assistant", text: "O Essencial está descrito na oferta." },
        ]);
        assert.match(block, /<prior_chat>/u);
        assert.match(block, /visitante: quanto custa/u);
        assert.equal(siteChatPostSchema.safeParse({ text: "oi", companyId: "x" }).success, false);
        assert.equal(siteChatPostSchema.safeParse({ text: "oi" }).success, true);
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
