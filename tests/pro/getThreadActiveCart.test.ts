import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getThreadActiveCart } from "@/src/pro/pipeline/getThreadActiveCart";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";
import type { OrderDraft, ProStep } from "@/src/types/contracts";

function makeDraft(items: OrderDraft["items"]): OrderDraft {
    return {
        items,
        address: null,
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: items.reduce((s, i) => s + i.quantity, 0),
        grandTotal: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
        pendingConfirmation: false,
        version: 1,
    };
}

type FakeSessionRow = { step: ProStep; context: Record<string, unknown>; updated_at: string } | null;
type FakeAbandonedRow = { draft: OrderDraft; detected_at: string } | null;

function makeAdmin(opts: {
    session?: FakeSessionRow;
    abandoned?: FakeAbandonedRow;
    siglaByEmbalagemId?: Record<string, string>;
}) {
    const admin = {
        from(table: string) {
            if (table === "chatbot_sessions") {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            gt() {
                                                return {
                                                    maybeSingle: async () => ({ data: opts.session ?? null, error: null }),
                                                };
                                            },
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }
            if (table === "abandoned_carts") {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            in() {
                                                return {
                                                    order() {
                                                        return {
                                                            limit() {
                                                                return {
                                                                    maybeSingle: async () => ({ data: opts.abandoned ?? null, error: null }),
                                                                };
                                                            },
                                                        };
                                                    },
                                                };
                                            },
                                        };
                                    },
                                };
                            },
                        };
                    },
                };
            }
            if (table === "view_pdv_produtos") {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    in: async (_col: string, ids: string[]) => ({
                                        data: ids.map((id) => ({
                                            id,
                                            sigla_comercial: opts.siglaByEmbalagemId?.[id] ?? "UN",
                                        })),
                                        error: null,
                                    }),
                                };
                            },
                        };
                    },
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };
    return admin as never;
}

describe("getThreadActiveCart", () => {
    it("retorna null quando não há sessão viva nem carrinho abandonado", async () => {
        const admin = makeAdmin({ session: null, abandoned: null });
        const r = await getThreadActiveCart({ admin, companyId: "c1", threadId: "t1" });
        assert.equal(r, null);
    });

    it("prioriza sessão viva com draft sobre abandono", async () => {
        const draft = makeDraft([
            { produtoEmbalagemId: "emb-1", productName: "Skol Lata", quantity: 2, unitPrice: 4.5, fatorConversao: 1, productVolumeId: null, estoqueUnidades: 10 },
        ]);
        const session: FakeSessionRow = {
            step: "pro_awaiting_payment_method",
            context: { [CHATBOT_SESSION_PRO_V2_STATE_KEY]: { step: "pro_awaiting_payment_method", draft } },
            updated_at: "2026-08-11T10:00:00Z",
        };
        const admin = makeAdmin({
            session,
            abandoned: { draft: makeDraft([]), detected_at: "2026-08-01T00:00:00Z" },
            siglaByEmbalagemId: { "emb-1": "UN" },
        });

        const r = await getThreadActiveCart({ admin, companyId: "c1", threadId: "t1" });
        assert.ok(r);
        assert.equal(r?.source, "live_session");
        assert.equal(r?.step, "pro_awaiting_payment_method");
        assert.equal(r?.stepLabel, "Aguardando forma de pagamento");
        assert.equal(r?.items.length, 1);
        assert.equal(r?.items[0].sigla, "UN");
        assert.equal(r?.items[0].subtotal, 9);
        assert.equal(r?.grandTotal, 9);
        assert.equal(r?.updatedAt, "2026-08-11T10:00:00Z");
    });

    it("cai pro carrinho abandonado quando não há sessão viva com itens", async () => {
        const draft = makeDraft([
            { produtoEmbalagemId: "emb-2", productName: "Fardo Skol", quantity: 1, unitPrice: 40, fatorConversao: 12, productVolumeId: null, estoqueUnidades: 5 },
        ]);
        const admin = makeAdmin({
            session: null,
            abandoned: { draft, detected_at: "2026-08-10T12:00:00Z" },
            siglaByEmbalagemId: { "emb-2": "FARD" },
        });

        const r = await getThreadActiveCart({ admin, companyId: "c1", threadId: "t1" });
        assert.ok(r);
        assert.equal(r?.source, "abandoned");
        assert.equal(r?.step, null);
        assert.equal(r?.stepLabel, "Carrinho abandonado (sessão expirou)");
        assert.equal(r?.items[0].sigla, "FARD");
        assert.equal(r?.updatedAt, "2026-08-10T12:00:00Z");
    });

    it("sessão viva sem itens no draft não bloqueia fallback pro abandono", async () => {
        const session: FakeSessionRow = {
            step: "pro_idle",
            context: { [CHATBOT_SESSION_PRO_V2_STATE_KEY]: { step: "pro_idle", draft: makeDraft([]) } },
            updated_at: "2026-08-11T09:00:00Z",
        };
        const draft = makeDraft([
            { produtoEmbalagemId: "emb-3", productName: "Heineken", quantity: 3, unitPrice: 6, fatorConversao: 1, productVolumeId: null, estoqueUnidades: 20 },
        ]);
        const admin = makeAdmin({ session, abandoned: { draft, detected_at: "2026-08-09T00:00:00Z" } });

        const r = await getThreadActiveCart({ admin, companyId: "c1", threadId: "t1" });
        assert.equal(r?.source, "abandoned");
        assert.equal(r?.items[0].productName, "Heineken");
    });
});
