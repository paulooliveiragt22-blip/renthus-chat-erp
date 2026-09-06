import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isBusinessSender,
    isCoexistenceWebhookField,
    parseAccountUpdateEvent,
    parseHistoryMessages,
    parseMessageEchoes,
} from "../../lib/channels/coexistenceWebhookParse";

describe("coexistence webhook parse", () => {
    it("reconhece fields e ignora messages", () => {
        assert.equal(isCoexistenceWebhookField("smb_message_echoes"), true);
        assert.equal(isCoexistenceWebhookField("history"), true);
        assert.equal(isCoexistenceWebhookField("messages"), false);
    });

    it("parseia eco do celular (não é inbound de cliente)", () => {
        const msgs = parseMessageEchoes({
            metadata: { phone_number_id: "1099" },
            message_echoes: [
                {
                    id: "wamid.echo1",
                    from: "5565999999999",
                    to: "5565888888888",
                    type: "text",
                    text: { body: "te mando hoje" },
                },
            ],
        });
        assert.equal(msgs.length, 1);
        assert.equal(msgs[0]?.waId, "wamid.echo1");
        assert.equal(msgs[0]?.body, "te mando hoje");
        assert.equal(msgs[0]?.to, "5565888888888");
    });

    it("parseia histórico e classifica remetente da loja", () => {
        const msgs = parseHistoryMessages({
            history: [
                {
                    threads: [
                        {
                            messages: [
                                {
                                    id: "wamid.h1",
                                    from: "5565999999999",
                                    to: "5565888888888",
                                    type: "text",
                                    text: { body: "oi" },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        assert.equal(msgs.length, 1);
        assert.equal(isBusinessSender("5565999999999", "+55 65 99999-9999"), true);
        assert.equal(isBusinessSender("5565888888888", "+55 65 99999-9999"), false);
    });

    it("PARTNER_ADDED extrai waba", () => {
        const ev = parseAccountUpdateEvent({
            event: "PARTNER_ADDED",
            waba_info: { waba_id: "123456" },
        });
        assert.equal(ev.event, "PARTNER_ADDED");
        assert.equal(ev.wabaId, "123456");
    });
});
