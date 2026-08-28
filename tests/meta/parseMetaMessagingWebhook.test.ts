import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    collectMetaAccountIds,
    extractMetaMessagingEvents,
    normalizeMetaMessagingWebhookBody,
} from "../../lib/meta/parseMetaMessagingWebhook";

describe("parseMetaMessagingWebhook", () => {
    it("normaliza payload embrulhado em array", () => {
        const body = normalizeMetaMessagingWebhookBody([
            {
                object: "instagram",
                entry: [{ id: "17841414682063238", messaging: [] }],
            },
        ]);
        assert.equal(body?.object, "instagram");
        assert.equal(body?.entry?.[0]?.id, "17841414682063238");
    });

    it("extrai messaging[] de DM Instagram", () => {
        const events = extractMetaMessagingEvents({
            id: "17841414682063238",
            messaging: [
                {
                    sender: { id: "cust_1" },
                    recipient: { id: "17841414682063238" },
                    message: { mid: "m1", text: "oi" },
                },
            ],
        });
        assert.equal(events.length, 1);
        assert.equal(events[0]?.message?.text, "oi");
    });

    it("coleta recipient.id para lookup de canal", () => {
        const events = extractMetaMessagingEvents({
            id: "wrong_id",
            messaging: [
                {
                    sender: { id: "cust_1" },
                    recipient: { id: "17841414682063238" },
                    message: { mid: "m1", text: "oi" },
                },
            ],
        });
        const ids = collectMetaAccountIds({ id: "wrong_id" }, events);
        assert.ok(ids.includes("17841414682063238"));
    });
});
