import assert from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd());

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

describe("ADR-0003 phase2 producers wire SQS afterEnqueue", () => {
    it("whatsapp incoming uses scheduleInboundAfterEnqueue", () => {
        const src = read("app/api/whatsapp/incoming/route.ts");
        assert.match(src, /scheduleInboundAfterEnqueue/);
        assert.doesNotMatch(src, /scheduleQueueWorkerWakeShared/);
    });

    it("meta messaging incoming uses scheduleInboundAfterEnqueue", () => {
        const src = read("app/api/meta/messaging/incoming/route.ts");
        assert.match(src, /scheduleInboundAfterEnqueue/);
        assert.doesNotMatch(src, /scheduleQueueWorkerWakeShared/);
    });

    it("outbound producers use afterEnqueue helpers", () => {
        assert.match(
            read("app/api/chatbot/detect-abandoned-carts/route.ts"),
            /scheduleOutboundAfterEnqueueLookup/
        );
        assert.match(read("lib/campaigns/enqueueCampaign.ts"), /scheduleOutboundAfterEnqueue/);
        assert.match(read("app/api/admin/orders/route.ts"), /scheduleOutboundAfterEnqueue/);
    });
});
