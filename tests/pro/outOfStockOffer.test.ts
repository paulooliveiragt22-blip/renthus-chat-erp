import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildOutOfStockOfferButtons,
    formatOutOfStockOfferText,
    isBlockedOutOfStockItem,
    parseOutOfStockNamesFromPrepareErrors,
    stripBlockedOutOfStockFromDraft,
} from "../../src/pro/pipeline/outOfStockOffer";
import { applyQuickAction, checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";
import { disambiguatePackagingForSearchRows } from "../../src/pro/pipeline/packagingDisambiguation";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

function item(partial: {
    name: string;
    qty: number;
    estoque: number;
    price?: number;
    id?: string;
    fator?: number;
    venderZero?: boolean;
}) {
    return {
        produtoEmbalagemId: partial.id ?? `emb-${partial.name}`,
        productName: partial.name,
        quantity: partial.qty,
        unitPrice: partial.price ?? 10,
        fatorConversao: partial.fator ?? 1,
        siglaComercial: "UN",
        productVolumeId: null,
        estoqueUnidades: partial.estoque,
        venderComEstoqueZero: partial.venderZero,
    };
}

function draftWith(items: ReturnType<typeof item>[]): OrderDraft {
    const totalItems = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    return {
        items,
        address: null,
        paymentMethod: null,
        changeFor: null,
        fulfillmentType: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems,
        grandTotal: totalItems,
        pendingConfirmation: false,
        version: 1,
    };
}

function baseState(over: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...over,
    };
}

describe("outOfStockOffer — vender_com_estoque_zero", () => {
    it("flag true (default) com estoque 0 → NÃO bloqueia", () => {
        assert.equal(
            isBlockedOutOfStockItem(item({ name: "SALGADINHO", qty: 1, estoque: 0, venderZero: true })),
            false
        );
        assert.equal(
            isBlockedOutOfStockItem(item({ name: "SALGADINHO", qty: 1, estoque: 0 })),
            false
        );
    });

    it("flag false + estoque insuficiente → bloqueia", () => {
        assert.equal(
            isBlockedOutOfStockItem(item({ name: "SALGADINHO", qty: 1, estoque: 0, venderZero: false })),
            true
        );
    });

    it("strip só remove flag=false; mantém quem pode vender zerado", () => {
        const draft = draftWith([
            item({ name: "HEINEKEN", qty: 2, estoque: 80, price: 10, venderZero: true }),
            item({ name: "SALGADINHO", qty: 1, estoque: 0, price: 15, venderZero: true }),
            item({ name: "AGUA", qty: 1, estoque: 0, price: 5, venderZero: false }),
        ]);
        const { draft: next, removedNames } = stripBlockedOutOfStockFromDraft(draft);
        assert.deepEqual(removedNames, ["AGUA"]);
        assert.equal(next?.items.length, 2);
        assert.ok(next?.items.some((i) => i.productName === "SALGADINHO"));
    });

    it("mensagem + botões Sim/Não", () => {
        assert.match(formatOutOfStockOfferText(["AGUA"]), /sem AGUA/);
        const btn = buildOutOfStockOfferButtons(["AGUA"]);
        assert.deepEqual(
            btn.buttons.map((b) => b.id),
            ["pro_oos_add_other", "pro_oos_continue"]
        );
    });

    it("parse nomes dos erros de prepare", () => {
        assert.deepEqual(
            parseOutOfStockNamesFromPrepareErrors([
                'Estoque insuficiente para "AGUA" (pediu 1; disponível ~0 na unidade de venda).',
            ]),
            ["AGUA"]
        );
    });
});

describe("checkoutPostProcess out-of-stock offer (flag)", () => {
    it("vender_com_estoque_zero=true → sem oferta; item permanece no carrinho", () => {
        const state = baseState({
            draft: draftWith([
                item({ name: "HEINEKEN", qty: 2, estoque: 80, venderZero: true }),
                item({ name: "SALGADINHO", qty: 1, estoque: 0, venderZero: true }),
            ]),
        });
        const out = checkoutPostProcess({
            state,
            outbound: [{ kind: "text", text: "ok" }],
            mode: "ai",
        });
        assert.notEqual(out.checkoutTurnKind, "offer_out_of_stock");
        assert.ok(!out.state.pendingOutOfStockOffer?.names?.length);
        assert.equal(out.state.draft?.items.length, 2);
    });

    it("flag false → remove OOS, mantém estoque ok e pergunta Sim/Não", () => {
        const state = baseState({
            draft: draftWith([
                item({ name: "HEINEKEN", qty: 2, estoque: 80, venderZero: true }),
                item({ name: "SALGADINHO", qty: 1, estoque: 0, venderZero: false }),
            ]),
        });
        const out = checkoutPostProcess({
            state,
            outbound: [{ kind: "text", text: "prosa IA sobre estoque" }],
            mode: "ai",
        });
        assert.equal(out.checkoutTurnKind, "offer_out_of_stock");
        assert.deepEqual(out.state.pendingOutOfStockOffer?.names, ["SALGADINHO"]);
        assert.equal(out.state.draft?.items.length, 1);
        assert.equal(out.outbound[0]?.kind, "buttons");
    });

    it("Sim → adicionar; Não → segue com carrinho", () => {
        const withOffer = baseState({
            draft: draftWith([item({ name: "HEINEKEN", qty: 2, estoque: 80 })]),
            pendingOutOfStockOffer: { names: ["SALGADINHO"] },
        });
        const yes = applyQuickAction("pro_oos_add_other", withOffer);
        assert.equal(yes.state.checkoutEditHold, true);
        const no = applyQuickAction("pro_oos_continue", withOffer);
        assert.equal(no.state.pendingOutOfStockOffer, null);
        assert.equal(no.outbound.length, 0);
    });
});

describe("Heineken lata multi-item: não herdar caixa de skol", () => {
    const heinekenLataRows = [
        {
            id: "hl-cx",
            display_name: "HEINEKEN LATA (CX c/8)",
            product_name: "HEINEKEN LATA",
            sigla_comercial: "CX",
            fator_conversao: 8,
            produto_id: "prod-hl",
            product_volume_id: "vol-hl",
        },
        {
            id: "hl-un",
            display_name: "HEINEKEN LATA",
            product_name: "HEINEKEN LATA",
            sigla_comercial: "UN",
            fator_conversao: 1,
            produto_id: "prod-hl",
            product_volume_id: "vol-hl",
        },
    ];

    it("'duas Heineken lata' no mesmo turno que '2 caixa de skol' → UN (não CX)", () => {
        const userText =
            "Quero 3 marmitas m, 2 caixa de skol lata, 2 Heineken longneck, duas Heineken lata, 1 salgadinho";
        const out = disambiguatePackagingForSearchRows(
            heinekenLataRows,
            "Heineken lata",
            userText,
            { habitSigla: "CX" }
        );
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, "hl-un");
    });
});
