import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interleaveQueueJobsByCompany } from "../../lib/chatbot/interleaveQueueJobsByCompany";

describe("interleaveQueueJobsByCompany", () => {
    it("0–2 itens: ordem preservada", () => {
        assert.deepEqual(interleaveQueueJobsByCompany([]), []);
        assert.deepEqual(interleaveQueueJobsByCompany([{ id: "a", company_id: "c1" }]), [
            { id: "a", company_id: "c1" },
        ]);
    });

    it("intercala dois tenants quando possível (a,a,b → a,b,a)", () => {
        const jobs = [
            { id: "1", company_id: "a" },
            { id: "2", company_id: "a" },
            { id: "3", company_id: "b" },
        ];
        const out = interleaveQueueJobsByCompany(jobs);
        assert.deepEqual(
            out.map((j) => j.id),
            ["1", "3", "2"]
        );
    });
});
