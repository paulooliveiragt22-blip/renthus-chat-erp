import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MARKETPLACE_OWN_DELIVERY,
    SAVINGS_EXAMPLE_VOLUME_CENTS,
    marketplaceCostCents,
    savingsExample,
} from "../../../lib/marketing/marketplaceFees";

describe("marketplaceCostCents", () => {
    it("soma comissão e mensalidade quando o volume passa da isenção", () => {
        const ifood = MARKETPLACE_OWN_DELIVERY[0]!;
        const aiqfome = MARKETPLACE_OWN_DELIVERY[1]!;
        const food99 = MARKETPLACE_OWN_DELIVERY[2]!;
        assert.equal(marketplaceCostCents(SAVINGS_EXAMPLE_VOLUME_CENTS, ifood), 163_000);
        assert.equal(marketplaceCostCents(SAVINGS_EXAMPLE_VOLUME_CENTS, aiqfome), 158_890);
        assert.equal(marketplaceCostCents(SAVINGS_EXAMPLE_VOLUME_CENTS, food99), 141_000);
    });

    it("não cobra mensalidade abaixo da faixa de isenção", () => {
        const ifood = MARKETPLACE_OWN_DELIVERY[0]!;
        assert.equal(marketplaceCostCents(180_000, ifood), Math.round((180_000 * 1520) / 10_000));
        assert.equal(marketplaceCostCents(0, ifood), 0);
    });
});

describe("savingsExample", () => {
    it("mostra quanto fica na loja contra o Pro de lista", () => {
        const example = savingsExample(34_900);
        assert.equal(example.volumeCents, 1_000_000);
        assert.equal(example.zampellCents, 34_900);
        const ifood = example.keptVersus.find((row) => row.id === "ifood");
        assert.equal(ifood?.keptCents, 128_100);
    });
});
