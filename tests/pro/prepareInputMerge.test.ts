import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, PrepareDraftToolInput } from "../../src/types/contracts";
import { extractInboundSlots } from "../../src/pro/domain/inboundSlots/extractInboundSlots";
import { resolvePrepareInput } from "../../src/pro/domain/inboundSlots/resolvePrepareInput";

const ITEMS = [{ produtoEmbalagemId: "emb-1", quantity: 2 }];

function input(overrides: Partial<PrepareDraftToolInput> = {}): PrepareDraftToolInput {
    return { items: ITEMS, address: null, ...overrides };
}

function draftWith(overrides: Partial<OrderDraft>): OrderDraft {
    return {
        items: [],
        address: null,
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 0,
        grandTotal: 0,
        pendingConfirmation: false,
        version: 1,
        ...overrides,
    };
}

const FULL_MESSAGE =
    "manda duas caixas de original lata aqui na rua tangara 850, sao mateus. pagamento no pix";

describe("resolvePrepareInput — endereço", () => {
    it("caminho server-side sem tool: endereço do texto entra no prepare", () => {
        const { input: out } = resolvePrepareInput({
            input: input(),
            currentDraft: null,
            slots: extractInboundSlots(FULL_MESSAGE),
        });
        assert.match(out.addressRaw ?? "", /tangara/i);
        assert.equal(out.paymentMethod, "pix");
    });

    it("modelo estruturou o mesmo endereço: mantém o do modelo (tem cidade/CEP)", () => {
        const structured = {
            logradouro: "Rua Tangará",
            numero: "850",
            bairro: "São Mateus",
            cidade: "São Paulo",
            estado: "SP",
        };
        const { input: out, conflicts } = resolvePrepareInput({
            input: input({ address: structured }),
            currentDraft: null,
            slots: extractInboundSlots(FULL_MESSAGE),
        });
        assert.deepEqual(out.address, structured);
        assert.ok(!conflicts.includes("address"));
    });

    it("modelo inventou outro número: o texto do cliente vence e vira conflito", () => {
        const { input: out, conflicts } = resolvePrepareInput({
            input: input({
                address: { logradouro: "Rua Tangará", numero: "112", bairro: "Centro" },
            }),
            currentDraft: null,
            slots: extractInboundSlots(FULL_MESSAGE),
        });
        assert.equal(out.address, null);
        assert.match(out.addressRaw ?? "", /850/);
        assert.ok(conflicts.includes("address"));
    });

    it("escolha explícita do fluxo (endereço salvo) vence o texto", () => {
        const { input: out } = resolvePrepareInput({
            input: input({ savedAddressId: "end-123" }),
            currentDraft: null,
            slots: extractInboundSlots(FULL_MESSAGE),
        });
        assert.equal(out.savedAddressId, "end-123");
        assert.equal(out.addressRaw ?? null, null);
    });

    it("turno sem endereço no texto não apaga o endereço do rascunho", () => {
        const { input: out } = resolvePrepareInput({
            input: input(),
            currentDraft: draftWith({
                address: {
                    logradouro: "Rua Tangará",
                    numero: "850",
                    bairro: "São Mateus",
                    complemento: null,
                },
            }),
            slots: extractInboundSlots("pode ser pix"),
        });
        assert.equal(out.addressRaw ?? null, null);
        assert.equal(out.paymentMethod, "pix");
    });

    it("cliente corrige o endereço: número novo do texto vence o rascunho", () => {
        const { input: out } = resolvePrepareInput({
            input: input(),
            currentDraft: draftWith({
                address: {
                    logradouro: "Rua Tangará",
                    numero: "850",
                    bairro: "São Mateus",
                    complemento: null,
                },
            }),
            slots: extractInboundSlots("mudou, é na rua tangara 200, sao mateus"),
        });
        assert.match(out.addressRaw ?? "", /200/);
    });
});

describe("resolvePrepareInput — pagamento e troco", () => {
    it("pagamento inventado pela LLM sem respaldo é descartado", () => {
        const { input: out, conflicts } = resolvePrepareInput({
            input: input({ paymentMethod: "pix" }),
            currentDraft: null,
            slots: extractInboundSlots("quero 2 skol"),
        });
        assert.equal(out.paymentMethod, null);
        assert.ok(conflicts.includes("payment"));
    });

    it("pagamento do rascunho sobrevive a turno sem menção", () => {
        const { input: out } = resolvePrepareInput({
            input: input(),
            currentDraft: draftWith({ paymentMethod: "pix" }),
            slots: extractInboundSlots("pode confirmar"),
        });
        assert.equal(out.paymentMethod, "pix");
    });

    it("troco só com dinheiro; pix zera change_for", () => {
        const { input: out } = resolvePrepareInput({
            input: input({ paymentMethod: "pix", changeFor: 100 }),
            currentDraft: null,
            slots: extractInboundSlots("no pix"),
        });
        assert.equal(out.changeFor, null);
    });

    it("dinheiro + troco na mesma frase entram juntos", () => {
        const { input: out } = resolvePrepareInput({
            input: input(),
            currentDraft: null,
            slots: extractInboundSlots("vou pagar em dinheiro, troco pra 100"),
        });
        assert.equal(out.paymentMethod, "cash");
        assert.equal(out.changeFor, 100);
    });
});
