import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichProSessionCustomerFromPhone } from "../../src/pro/pipeline/enrichCustomerFromPhone";
import type { ProSessionState } from "../../src/types/contracts";

describe("enrichProSessionCustomerFromPhone", () => {
    it("sem admin nao altera estado", async () => {
        const s: ProSessionState = {
            step: "pro_idle",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
        };
        const out = await enrichProSessionCustomerFromPhone({
            admin: undefined,
            companyId: "c1",
            phoneE164: "+5511999999999",
            profileName: null,
            state: s,
        });
        assert.strictEqual(out, s);
    });

    it("ja com customerId nao chama supabase", async () => {
        const s: ProSessionState = {
            step: "pro_idle",
            customerId: "existing",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
        };
        const out = await enrichProSessionCustomerFromPhone({
            admin: {} as never,
            companyId: "c1",
            phoneE164: "+5511999999999",
            profileName: null,
            state: s,
        });
        assert.equal(out.customerId, "existing");
    });
});
