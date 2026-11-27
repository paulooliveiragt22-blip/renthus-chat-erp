import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { customerCardDeclineMessage } from "../../lib/billing/customerCardDecline";

describe("customerCardDeclineMessage", () => {
    it("traduz o número inválido do lojista para quem paga", () => {
        const message = customerCardDeclineMessage({
            returnCode: "1011",
            acquirerMessage:
                "Número do cartão inválido. Oriente o usuário a contatar o banco/emissor do cartão",
        });
        assert.match(message, /número do cartão não foi aceito/iu);
        assert.match(message, /PIX/u);
        assert.equal(message.includes("Oriente o usuário"), false);
        assert.equal(message.includes("Pagar.me"), false);
        assert.equal(message.includes("sandbox"), false);
    });

    it("reconhece a frase do lojista mesmo sem o código", () => {
        const message = customerCardDeclineMessage({
            acquirerMessage:
                "Número do cartão inválido. Oriente o usuário a contatar o banco/emissor do cartão",
        });
        assert.match(message, /número do cartão não foi aceito/iu);
    });

    it("separa saldo, validade e código de segurança", () => {
        assert.match(customerCardDeclineMessage({ returnCode: "1016" }), /limite ou saldo/iu);
        assert.match(customerCardDeclineMessage({ returnCode: "1001" }), /vencido/iu);
        assert.match(customerCardDeclineMessage({ returnCode: "1045" }), /código de segurança/iu);
    });

    it("não mostra texto de teste quando o banco não devolve detalhe", () => {
        const message = customerCardDeclineMessage({});
        assert.match(message, /não autorizou este cartão/iu);
        assert.equal(message.includes("cartão real"), false);
        assert.equal(message.includes("4000000000000010"), false);
    });
});
