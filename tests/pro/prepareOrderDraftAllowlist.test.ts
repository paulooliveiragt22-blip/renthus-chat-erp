import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareOrderDraftFromTool } from "../../lib/chatbot/pro/prepareOrderDraft";

describe("prepareOrderDraftFromTool / search_allowlist", () => {
    it("rejeita produto_embalagem_id fora da allowlist antes de tocar no catálogo", async () => {
        const admin = null as unknown as SupabaseClient;
        const res = await prepareOrderDraftFromTool(
            admin,
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produto_embalagem_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 1 }],
                // Sem endereço: evita resolveDeliveryForNeighborhood(admin) — foco só na allowlist.
                address: null,
                address_raw: null,
                saved_address_id: null,
                use_saved_address: false,
                payment_method: "pix",
                change_for: null,
                ready_for_confirmation: false,
            },
            {
                kind: "search_allowlist",
                allowedEmbalagemIds: [
                    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    "cccccccc-cccc-cccc-cccc-cccccccccccc",
                ],
            }
        );
        assert.equal(res.ok, false);
        assert.ok(res.errors.some((e) => e.includes("última busca") || e.includes("ultima busca")));
    });

    it("rejeita slug textual (não UUID) com mensagem específica em search_allowlist", async () => {
        const admin = null as unknown as SupabaseClient;
        const res = await prepareOrderDraftFromTool(
            admin,
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produto_embalagem_id: "heineken-long-neck-330ml-caixa-6", quantity: 1 }],
                address: null,
                address_raw: null,
                saved_address_id: null,
                use_saved_address: false,
                payment_method: "pix",
                change_for: null,
                ready_for_confirmation: false,
            },
            { kind: "search_allowlist", allowedEmbalagemIds: ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"] }
        );
        assert.equal(res.ok, false);
        assert.ok(res.errors.some((e) => e.includes("slug") || e.includes("UUID")));
        assert.ok(!res.errors.some((e) => e.includes("heineken-long-neck") && e.includes("última busca")));
    });

    it("com allowlist vazia e itens, exige search_produtos primeiro", async () => {
        const admin = null as unknown as SupabaseClient;
        const res = await prepareOrderDraftFromTool(
            admin,
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produto_embalagem_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 1 }],
                address: null,
                address_raw: null,
                saved_address_id: null,
                use_saved_address: false,
                payment_method: "pix",
                change_for: null,
                ready_for_confirmation: false,
            },
            { kind: "search_allowlist", allowedEmbalagemIds: [] }
        );
        assert.equal(res.ok, false);
        assert.ok(res.errors.some((e) => /search_produtos/i.test(e)));
    });

    it("com única embalagem na allowlist e UUID inventado, substitui pelo id permitido antes de carregar o catálogo", async () => {
        const sole = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
        const admin = {
            from(table: string) {
                if (table === "view_chat_produtos") {
                    return {
                        select() {
                            return {
                                eq() {
                                    return {
                                        maybeSingle: async () => ({ data: null }),
                                    };
                                },
                            };
                        },
                    };
                }
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return { maybeSingle: async () => ({ data: null }) };
                                    },
                                };
                            },
                        };
                    },
                };
            },
        } as unknown as SupabaseClient;
        const res = await prepareOrderDraftFromTool(
            admin,
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produto_embalagem_id: "98a7f3e0-1c2b-4d5e-9f8a-2b1c3d4e5f6a", quantity: 1 }],
                address: null,
                address_raw: null,
                saved_address_id: null,
                use_saved_address: false,
                payment_method: "pix",
                change_for: null,
                ready_for_confirmation: false,
            },
            { kind: "search_allowlist", allowedEmbalagemIds: [sole] }
        );
        assert.equal(res.ok, false);
        assert.ok(
            res.errors.some((e) => e.includes("Embalagem inválida") || e.includes("Embalagem invalida")),
            "esperado passar pela allowlist após coerção e falhar no load do pack"
        );
        assert.ok(!res.errors.some((e) => /última busca|ultima busca/i.test(e)));
    });
});
