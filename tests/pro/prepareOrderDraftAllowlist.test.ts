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
            { kind: "search_allowlist", allowedEmbalagemIds: ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"] }
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
});
