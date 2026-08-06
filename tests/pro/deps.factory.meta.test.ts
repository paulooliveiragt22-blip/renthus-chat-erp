import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeProPipelineDependencies } from "@/src/pro/pipeline/deps.factory";
import { WhatsAppMessageGateway } from "@/src/pro/adapters/whatsapp/message.gateway.whatsapp";
import { MetaMessageGateway } from "@/src/pro/adapters/meta/message.gateway.meta";

describe("makeProPipelineDependencies channel gateway", () => {
    const admin = {} as never;

    it("usa WhatsAppMessageGateway por default", () => {
        const deps = makeProPipelineDependencies({
            admin,
            companyId: "c",
            threadId: "t",
            messageId: "m",
            phoneE164: "+5511999999999",
            text: "oi",
        });
        assert.ok(deps.messageGateway instanceof WhatsAppMessageGateway);
    });

    it("usa MetaMessageGateway para instagram", () => {
        const deps = makeProPipelineDependencies({
            admin,
            companyId: "c",
            threadId: "t",
            messageId: "m",
            phoneE164: "",
            channelUserId: "17841400000000000",
            messagingChannel: "instagram",
            text: "oi",
        });
        assert.ok(deps.messageGateway instanceof MetaMessageGateway);
    });
});
