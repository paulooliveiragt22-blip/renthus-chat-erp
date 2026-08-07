import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isExplicitOrderConfirmation,
    looksLikeCheckoutRevisionText,
} from "../../src/pro/pipeline/orderConfirmationText";

describe("looksLikeCheckoutRevisionText", () => {
    it("detecta pedido multi-item tipico", () => {
        assert.equal(
            looksLikeCheckoutRevisionText(
                "quero uma Heineken long neck, caixa um hamburguer monstro e um salgadinho"
            ),
            true
        );
    });

    it("nao confunde botao confirmar com revisao; prosa sim nao finaliza", () => {
        assert.equal(isExplicitOrderConfirmation("sim"), false);
        assert.equal(isExplicitOrderConfirmation("pro_confirm_order"), true);
        assert.equal(looksLikeCheckoutRevisionText("sim"), false);
        assert.equal(looksLikeCheckoutRevisionText("pro_confirm_order"), false);
        assert.equal(looksLikeCheckoutRevisionText("confirmar"), false);
    });

    it("detecta corrigir/adicionar", () => {
        assert.equal(looksLikeCheckoutRevisionText("corrigir o pedido"), true);
        assert.equal(looksLikeCheckoutRevisionText("adicionar mais um item"), true);
    });
});
