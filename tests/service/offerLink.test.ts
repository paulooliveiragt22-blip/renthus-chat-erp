import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { httpsOfferLink, offerLinkLabel } from "../../src/service/domain/offerLink";

describe("botão da oferta", () => {
    it("aceita os três rótulos e cai em Ver oferta", () => {
        assert.equal(offerLinkLabel("Ver plano"), "Ver plano");
        assert.equal(offerLinkLabel("Ver serviço"), "Ver serviço");
        assert.equal(offerLinkLabel("abrir"), "Ver oferta");
    });

    it("só guarda link https", () => {
        assert.equal(httpsOfferLink("https://zampell.com.br/plano"), "https://zampell.com.br/plano");
        assert.equal(httpsOfferLink("http://zampell.com.br"), null);
        assert.equal(httpsOfferLink("  "), null);
    });
});
