/**
 * Fluxo misto atendente→cliente:
 *  - "Enviar resumo": draft selado + botões (pedido só no clique do cliente)
 *  - "Finalizar pedido": atendente fecha na hora (idempotência determinística)
 *  - Ingress: clique Confirmar entra na fila mesmo com bot pausado, só se houver `pending`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    attendantFinalizeIdempotencyKey,
    buildHitlSummaryText,
    parseAttendantCartBody,
} from "../../src/pro/pipeline/attendantCartDraft";
import { shouldEnqueueHitlCheckoutDespiteHandover } from "../../src/pro/pipeline/hitlHandoverBypass";

function validBody() {
    return {
        items: [
            { produtoEmbalagemId: "pe-1", productName: "Heineken (CX)", quantity: 2, unitPrice: 60 },
            { produtoEmbalagemId: "pe-2", productName: "Skol Lata (UN)", quantity: 3, unitPrice: 5 },
        ],
        address: {
            logradouro: "Rua A",
            numero: "10",
            bairro: "Centro",
            cidade: "Aracaju",
            estado: "se",
        },
        paymentMethod: "pix" as const,
        deliveryFee: 7,
    };
}

/** Admin mínimo: `whatsapp_order_confirmations` com N linhas `pending`. */
function fakeAdmin(pending: { id: string } | null) {
    return {
        from: () => {
            const api: Record<string, unknown> = {};
            api.select = () => api;
            api.eq = () => api;
            api.limit = () => api;
            api.maybeSingle = async () => ({ data: pending, error: null });
            return api;
        },
    } as never;
}

describe("attendantCartDraft (carrinho do atendente)", () => {
    it("normaliza draft e recalcula totais", () => {
        const parsed = parseAttendantCartBody(validBody());
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.draft.totalItems, 135);
        assert.equal(parsed.draft.grandTotal, 142);
        assert.equal(parsed.draft.address?.estado, "SE");
        assert.equal(parsed.draft.pendingConfirmation, false);
    });

    it("rejeita carrinho vazio, pagamento inválido e endereço incompleto", () => {
        const cases: Array<[unknown, string]> = [
            [{ ...validBody(), items: [] }, "items_required"],
            [{ ...validBody(), paymentMethod: "boleto" }, "invalid_payment_method"],
            [
                { ...validBody(), address: { ...validBody().address, numero: " " } },
                "invalid_address",
            ],
        ];
        for (const [body, code] of cases) {
            const parsed = parseAttendantCartBody(body);
            assert.equal(parsed.ok, false, code);
            if (!parsed.ok) assert.equal(parsed.code, code);
        }
    });

    it("troco só entra em pagamento em dinheiro", () => {
        const pix = parseAttendantCartBody({ ...validBody(), changeFor: 200 });
        assert.equal(pix.ok && pix.draft.changeFor, null);
        const cash = parseAttendantCartBody({
            ...validBody(),
            paymentMethod: "cash",
            changeFor: 200,
        });
        assert.equal(cash.ok && cash.draft.changeFor, 200);
    });

    it("resumo HITL manda botão, não instrução de digitar CONFIRMAR", () => {
        const parsed = parseAttendantCartBody(validBody());
        assert.ok(parsed.ok);
        if (!parsed.ok) return;
        const text = buildHitlSummaryText({
            items: parsed.items,
            address: parsed.address,
            paymentMethod: "pix",
            deliveryFee: parsed.draft.deliveryFee,
            grandTotal: parsed.draft.grandTotal,
        });
        assert.match(text, /Total: R\$ 142,00/);
        assert.match(text, /Taxa de entrega: R\$ 7,00/);
        assert.match(text, /\*Confirmar\*/);
        assert.ok(!/responda CONFIRMAR/i.test(text));
    });

    it("idempotência do finalize é determinística por carrinho (duplo clique = 1 pedido)", () => {
        const a = parseAttendantCartBody(validBody());
        const b = parseAttendantCartBody(validBody());
        assert.ok(a.ok && b.ok);
        if (!a.ok || !b.ok) return;
        assert.equal(
            attendantFinalizeIdempotencyKey("th-1", "user-1", a.draft),
            attendantFinalizeIdempotencyKey("th-1", "user-1", b.draft)
        );

        const changed = parseAttendantCartBody({ ...validBody(), deliveryFee: 9 });
        assert.ok(changed.ok);
        if (!changed.ok) return;
        assert.notEqual(
            attendantFinalizeIdempotencyKey("th-1", "user-1", a.draft),
            attendantFinalizeIdempotencyKey("th-1", "user-1", changed.draft)
        );
    });
});

describe("ingress HITL com bot pausado", () => {
    const base = { companyId: "co-1", threadId: "th-1" };

    it("botão Confirmar com confirmação pending → enfileira", async () => {
        const ok = await shouldEnqueueHitlCheckoutDespiteHandover({
            admin: fakeAdmin({ id: "conf-1" }),
            ...base,
            bodyText: "pro_confirm_order",
        });
        assert.equal(ok, true);
    });

    it("botão Cancelar com pending → enfileira", async () => {
        const ok = await shouldEnqueueHitlCheckoutDespiteHandover({
            admin: fakeAdmin({ id: "conf-1" }),
            ...base,
            bodyText: "pro_cancel_order",
        });
        assert.equal(ok, true);
    });

    it("botão órfão (sem pending) → não enfileira", async () => {
        const ok = await shouldEnqueueHitlCheckoutDespiteHandover({
            admin: fakeAdmin(null),
            ...base,
            bodyText: "pro_confirm_order",
        });
        assert.equal(ok, false);
    });

    it("prosa não abre bypass nem com pending (ADR-0005 C1)", async () => {
        for (const text of ["sim", "ok", "confirmar", "1", "pode mandar"]) {
            const ok = await shouldEnqueueHitlCheckoutDespiteHandover({
                admin: fakeAdmin({ id: "conf-1" }),
                ...base,
                bodyText: text,
            });
            assert.equal(ok, false, text);
        }
    });
});
