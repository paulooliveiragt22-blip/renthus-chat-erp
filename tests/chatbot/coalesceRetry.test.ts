import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldCoalesceInbound, buildCoalesceKey } from "../../lib/chatbot/queue/coalesce";
import type { AdminClient } from "../../lib/chatbot/queue/types";

describe("shouldCoalesceInbound — retries", () => {
    it("não coalese quando attempts > 0 (retry 429)", async () => {
        const admin = {
            from: () => {
                throw new Error("não deve consultar PG em retry");
            },
        } as unknown as AdminClient;
        const key = buildCoalesceKey("t1", "5511999", "c1", "quero 3 marmitas p", "text");
        assert.ok(key);
        const dup = await shouldCoalesceInbound(
            admin,
            {
                id: "job-retry",
                thread_id: "t1",
                phone_e164: "5511999",
                company_id: "c1",
                body_text: "quero 3 marmitas p",
                metadata: { message_type: "text" },
                attempts: 1,
            },
            key!,
            new Set([key!])
        );
        assert.equal(dup, false);
    });
});
