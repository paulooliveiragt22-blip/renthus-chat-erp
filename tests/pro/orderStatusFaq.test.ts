import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatOrderStatusBody,
    wantsRecentOrdersList,
    type StatusOrderRow,
} from "../../src/pro/pipeline/orderStatusFaq";

const openDelivery: StatusOrderRow = {
    id: "00000000-0000-0000-0000-000000e83e79",
    status: "preparing",
    confirmationStatus: "confirmed",
    fulfillmentType: "delivery",
};

const closed: StatusOrderRow = {
    id: "00000000-0000-0000-0000-000000aaaaaa",
    status: "finalized",
    confirmationStatus: "confirmed",
    fulfillmentType: "delivery",
};

describe("formatOrderStatusBody", () => {
    it("cadê meu pedido: uma frase do aberto, com previsão, e o link na segunda linha", () => {
        const text = formatOrderStatusBody({
            orders: [openDelivery, closed],
            list: false,
            etaMin: 40,
            ordersMenuUrl: "https://app.example/c/loja?orders=1",
        });
        assert.equal(
            text,
            "Seu pedido #E83E79 está *Em preparo*, previsão de 40 min.\n\nAcompanhe em: https://app.example/c/loja?orders=1"
        );
    });

    it("sem previsão e sem link, a frase fica só com o status", () => {
        const text = formatOrderStatusBody({
            orders: [openDelivery],
            list: false,
            etaMin: null,
        });
        assert.equal(text, "Seu pedido #E83E79 está *Em preparo*.");
    });

    it("retirada não leva previsão de entrega", () => {
        const text = formatOrderStatusBody({
            orders: [{ ...openDelivery, fulfillmentType: "pickup" }],
            list: false,
            etaMin: 40,
        });
        assert.equal(text, "Seu pedido #E83E79 está *Em preparo*.");
    });

    it("sem pedido aberto, cita o último encerrado", () => {
        const text = formatOrderStatusBody({
            orders: [closed],
            list: false,
            etaMin: 40,
        });
        assert.equal(text, "Não há pedido em andamento. O último foi #AAAAAA: *Finalizado*.");
    });

    it("meus pedidos lista até três e põe a previsão só no aberto", () => {
        const text = formatOrderStatusBody({
            orders: [openDelivery, closed],
            list: true,
            etaMin: 15,
        });
        assert.match(text ?? "", /Seus pedidos recentes:/);
        assert.match(text ?? "", /#E83E79: \*Em preparo\*, previsão de 15 min/);
        assert.match(text ?? "", /#AAAAAA: \*Finalizado\*/);
        assert.equal(text?.includes("previsão de 15 min"), true);
        assert.equal((text ?? "").includes("Acompanhe"), false);
    });
});

describe("wantsRecentOrdersList", () => {
    it("botão e plural listam; cadê meu pedido não", () => {
        assert.equal(wantsRecentOrdersList("btn_status"), true);
        assert.equal(wantsRecentOrdersList("ver meus pedidos"), true);
        assert.equal(wantsRecentOrdersList("cadê meu pedido"), false);
        assert.equal(wantsRecentOrdersList("status"), false);
    });
});
