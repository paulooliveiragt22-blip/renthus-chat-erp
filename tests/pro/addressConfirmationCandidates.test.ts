import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAddressConfirmationCandidates } from "../../src/pro/pipeline/addressConfirmationCandidates";
import type { AddressDeliveryStat } from "../../src/pro/tools/resolveSavedAddress";

function addr(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        apelido: null,
        logradouro: "Rua A",
        numero: "1",
        complemento: null,
        bairro: "Centro",
        cidade: "Sorriso",
        estado: "MT",
        cep: null,
        is_principal: false,
        ...overrides,
    };
}

describe("resolveAddressConfirmationCandidates", () => {
    it("sem endereço cadastrado → nada", () => {
        const r = resolveAddressConfirmationCandidates([]);
        assert.equal(r.primary, null);
        assert.equal(r.secondary, null);
    });

    it("só 1 endereço → primary, sem secondary", () => {
        const stats: AddressDeliveryStat[] = [
            { address: addr("a"), deliveryCount: 3, lastDeliveredAt: "2026-01-01" },
        ];
        const r = resolveAddressConfirmationCandidates(stats);
        assert.equal(r.primary?.id, "a");
        assert.equal(r.secondary, null);
    });

    it("mais entregas em A, último pedido em B → A vs B", () => {
        const stats: AddressDeliveryStat[] = [
            { address: addr("a"), deliveryCount: 10, lastDeliveredAt: "2025-01-01" },
            { address: addr("b"), deliveryCount: 2, lastDeliveredAt: "2026-06-01" },
        ];
        const r = resolveAddressConfirmationCandidates(stats);
        assert.equal(r.primary?.id, "a");
        assert.equal(r.secondary?.id, "b");
    });

    it("mesmo endereço é o mais usado e o mais recente → sem secondary", () => {
        const stats: AddressDeliveryStat[] = [
            { address: addr("a"), deliveryCount: 10, lastDeliveredAt: "2026-06-01" },
            { address: addr("b"), deliveryCount: 1, lastDeliveredAt: "2025-01-01" },
        ];
        const r = resolveAddressConfirmationCandidates(stats);
        assert.equal(r.primary?.id, "a");
        assert.equal(r.secondary, null);
    });

    it("empate em entregas → desempata por is_principal", () => {
        const stats: AddressDeliveryStat[] = [
            { address: addr("a", { is_principal: false }), deliveryCount: 5, lastDeliveredAt: "2026-01-01" },
            { address: addr("b", { is_principal: true }), deliveryCount: 5, lastDeliveredAt: "2025-01-01" },
        ];
        const r = resolveAddressConfirmationCandidates(stats);
        assert.equal(r.primary?.id, "b");
    });

    it("sem histórico de pedidos (0 entregas em todos) → sem secondary", () => {
        const stats: AddressDeliveryStat[] = [
            { address: addr("a"), deliveryCount: 0, lastDeliveredAt: null },
            { address: addr("b"), deliveryCount: 0, lastDeliveredAt: null },
        ];
        const r = resolveAddressConfirmationCandidates(stats);
        assert.equal(r.secondary, null);
    });
});
