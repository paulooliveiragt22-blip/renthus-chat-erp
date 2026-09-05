import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryLocalPrintQueue } from "../../lib/offline/adapters/memoryLocalPrintQueue";
import { createPrintIntentId } from "../../lib/offline/domain/LocalPrintJob";

describe("offline Local Print Bus", () => {
    it("enqueue + markPrinted", async () => {
        const q = createMemoryLocalPrintQueue();
        const id = createPrintIntentId();
        const job = await q.enqueue({
            clientPrintId: id,
            companyId: "co-1",
            total: 10,
            items: [{ name: "Skol", qty: 1, price: 10 }],
            payments: [{ method: "PIX", value: 10 }],
        });
        assert.equal(job.status, "queued");
        await q.markPrinted(id);
        const got = await q.get(id);
        assert.equal(got?.status, "printed");
        assert.ok(got?.printedAt);
    });
});
