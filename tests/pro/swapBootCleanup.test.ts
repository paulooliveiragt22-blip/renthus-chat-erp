import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { removeDraftItemsMatchingName } from "../../src/pro/pipeline/mergeOrderDraft";
import type { OrderDraft } from "../../src/types/contracts";

/**
 * Espelha a limpeza de boot no swap: IDs removidos do draft saem do bootstrapResolved.
 */
function stripBootAfterSwapRemove(
    draft: OrderDraft | null,
    removeName: string,
    bootIds: string[]
): { draft: OrderDraft | null; boot: string[] } {
    const beforeIds = new Set((draft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean));
    const next = removeDraftItemsMatchingName(draft, removeName);
    const afterIds = new Set((next?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean));
    const removed = new Set([...beforeIds].filter((id) => !afterIds.has(id)));
    return {
        draft: next,
        boot: bootIds.filter((id) => id && !removed.has(id)),
    };
}

describe("swap boot cleanup", () => {
    it("troca salgadinho: UN sai do draft e do boot; CX pode entrar no pick", () => {
        const draft: OrderDraft = {
            items: [
                {
                    produtoEmbalagemId: "burger",
                    productName: "BURGER",
                    quantity: 1,
                    unitPrice: 25,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 5,
                },
                {
                    produtoEmbalagemId: "salg-un",
                    productName: "SALGADINHO",
                    quantity: 1,
                    unitPrice: 15,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 5,
                },
            ],
            address: null,
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 15,
            deliveryZoneId: null,
            deliveryAddressText: null,
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 40,
            grandTotal: 55,
            pendingConfirmation: false,
            version: 1,
        };
        const { draft: next, boot } = stripBootAfterSwapRemove(draft, "salgadinho", [
            "burger",
            "heineken",
            "salg-un",
        ]);
        assert.deepEqual(
            (next?.items ?? []).map((i) => i.produtoEmbalagemId),
            ["burger"]
        );
        assert.deepEqual(boot, ["burger", "heineken"]);
        assert.ok(!boot.includes("salg-un"));
    });
});
