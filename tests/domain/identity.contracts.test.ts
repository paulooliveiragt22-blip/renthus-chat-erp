import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    ChannelIdentitySchema,
    MessagingChannelSchema,
    PhoneE164Schema,
} from "@/src/domain/contracts/identity";

describe("identity contracts", () => {
    it("aceita canais conhecidos", () => {
        assert.equal(MessagingChannelSchema.parse("whatsapp"), "whatsapp");
        assert.equal(MessagingChannelSchema.parse("instagram"), "instagram");
        assert.throws(() => MessagingChannelSchema.parse("telegram"));
    });

    it("discriminated union por canal", () => {
        const wa = ChannelIdentitySchema.parse({
            channel: "whatsapp",
            externalId: "+5511999999999",
        });
        assert.equal(wa.channel, "whatsapp");

        const ig = ChannelIdentitySchema.parse({
            channel: "instagram",
            externalId: "12345678901",
        });
        assert.equal(ig.channel, "instagram");
    });

    it("valida PhoneE164", () => {
        assert.ok(PhoneE164Schema.parse("+5511987654321"));
        assert.throws(() => PhoneE164Schema.parse("11987654321"));
    });
});
