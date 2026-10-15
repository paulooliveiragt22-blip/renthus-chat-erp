import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { botReadinessChecks, botReadinessGaps, type BotReadinessFlags } from "../../lib/channels/botReadiness";

const complete: BotReadinessFlags = {
    hasSalePrice: true,
    hasStock: true,
    hasCommercialSigla: true,
    hasDeliveryZoneFee: true,
    hasOpeningHours: true,
    hasStoreAddress: true,
};

describe("botReadiness", () => {
    it("lista vazia quando os seis itens passam", () => {
        assert.deepEqual(botReadinessGaps(complete), []);
        assert.equal(botReadinessChecks(complete).every((check) => check.ok), true);
    });

    it("nomeia só o que falta, na ordem da leitura", () => {
        assert.deepEqual(
            botReadinessGaps({
                ...complete,
                hasSalePrice: false,
                hasStoreAddress: false,
            }),
            ["Preço de venda em alguma embalagem", "Endereço da loja"]
        );
    });
});
