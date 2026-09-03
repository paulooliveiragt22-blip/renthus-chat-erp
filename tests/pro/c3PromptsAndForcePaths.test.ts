import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildDeliverySpecialistSystemPreamble,
    SYSTEM_HARD_RULES_PT,
} from "../../src/pro/tools/checkoutPhasePolicy";
import { hasExplicitOrderQuantityInText } from "../../src/pro/tools/parseQtyPt";
import {
    respondToCustomerToolDescription,
    shouldForcePrepareAfterUnambiguousSearch,
    shouldForceResolvePendingPicks,
} from "../../src/pro/adapters/ai/ai.service";

describe("C3.1 system preamble / hard rules", () => {
    it("preamble NÃO manda listar opções/preços (servidor esclarece)", () => {
        const p = buildDeliverySpecialistSystemPreamble().toLowerCase();
        assert.ok(!p.includes("liste opções claras"));
        assert.ok(p.includes("não liste") || p.includes("nÃO liste".toLowerCase()));
        assert.match(buildDeliverySpecialistSystemPreamble(), /servidor/i);
    });

    it("SYSTEM_HARD_RULES_PT cobre allowlist, qty, respond e não-confirmar", () => {
        const joined = SYSTEM_HARD_RULES_PT.join(" | ").toLowerCase();
        assert.ok(joined.includes("produto_embalagem_id"));
        assert.ok(joined.includes("quantity=1"));
        assert.ok(joined.includes("respond_to_customer"));
        assert.ok(joined.includes("pedido confirmado") || joined.includes("já foi criado"));
    });
});

describe("C3.2 force-prepare exige qty", () => {
    const base = {
        intent: "order_intent",
        step: "pro_collecting_order",
        prepareInvokedThisTurn: false,
        searchInvokedThisTurn: true,
        allowlistNowCount: 1,
        userText: "quero 2 heineken",
    };

    it("força quando SKU único + qty explícita (S2)", () => {
        assert.equal(shouldForcePrepareAfterUnambiguousSearch(base), true);
    });

    it("não força 'quero original' sem quantidade", () => {
        assert.equal(
            shouldForcePrepareAfterUnambiguousSearch({
                ...base,
                userText: "quero original",
            }),
            false
        );
    });

    it("hasExplicitOrderQuantityInText: dígito, por extenso e um/uma", () => {
        assert.equal(hasExplicitOrderQuantityInText("quero 2 skol"), true);
        assert.equal(hasExplicitOrderQuantityInText("quero duas skol"), true);
        assert.equal(hasExplicitOrderQuantityInText("me manda uma coca"), true);
        assert.equal(hasExplicitOrderQuantityInText("quero original"), false);
    });

    it("shouldForceResolvePendingPicks: só com grupos (carryover no caller)", () => {
        assert.equal(
            shouldForceResolvePendingPicks({ infoOnly: false, pendingPickGroups: [] }),
            false
        );
        assert.equal(
            shouldForceResolvePendingPicks({
                infoOnly: false,
                pendingPickGroups: [
                    {
                        productKey: "skol",
                        productLabel: "SKOL",
                        unresolvedTurns: 1,
                        options: [],
                    },
                ],
            }),
            true
        );
        assert.equal(
            shouldForceResolvePendingPicks({
                infoOnly: true,
                pendingPickGroups: [
                    {
                        productKey: "skol",
                        productLabel: "SKOL",
                        unresolvedTurns: 1,
                        options: [],
                    },
                ],
            }),
            false
        );
    });
});

describe("C3.4 respond_to_customer description", () => {
    it("proíbe afirmar pedido criado e pedir digitar sim", () => {
        const d = respondToCustomerToolDescription().toLowerCase();
        assert.ok(d.includes("obrigatória") || d.includes("obrigatoria"));
        assert.ok(d.includes("não diga") || d.includes("nao diga") || d.includes("criado"));
        assert.ok(d.includes("sim") || d.includes("botões") || d.includes("botoes"));
    });
});
