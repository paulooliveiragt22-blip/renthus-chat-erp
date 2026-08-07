import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runOrderHintsForAi } from "../../src/pro/adapters/ai/tools/orderHintsForAi";

describe("runOrderHintsForAi", () => {
    it("com prefetchedOrderHints: reaproveita o cache do turno e adiciona guidance_for_model_pt", async () => {
        const prefetched = { customer_known: true, favoritos: ["skol lata"] };
        const result = await runOrderHintsForAi({
            admin: {} as unknown as SupabaseClient,
            companyId: "company-1",
            phoneE164: "+5511999999999",
            profileName: "Cliente Teste",
            prefetchedOrderHints: prefetched,
        });
        assert.equal(result.customer_known, true);
        assert.deepEqual(result.favoritos, ["skol lata"]);
        const guidance = result.guidance_for_model_pt as string[];
        assert.ok(guidance.join("\n").includes("Hints já carregados no servidor"));
    });

    it("prefetchedOrderHints não-objeto (ex.: undefined) não é tratado como cache e cai no fallback via banco", async () => {
        const admin = {
            from() {
                throw new Error("stop-here: chegou ao fallback (comportamento esperado)");
            },
            rpc() {
                throw new Error("stop-here: chegou ao fallback (comportamento esperado)");
            },
        } as unknown as SupabaseClient;
        await assert.rejects(
            runOrderHintsForAi({
                admin,
                companyId: "company-1",
                phoneE164: "+5511999999999",
                profileName: null,
                prefetchedOrderHints: undefined,
            })
        );
    });
});
