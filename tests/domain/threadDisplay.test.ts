import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    channelBadgeLabel,
    threadDisplayName,
    threadDisplaySubtitle,
} from "@/src/domain/messaging/threadDisplay";

describe("threadDisplay (B10)", () => {
    it("usa profile name quando existe", () => {
        assert.equal(
            threadDisplayName({
                channel: "instagram",
                profileName: "Ana",
                phoneE164: null,
            }),
            "Ana"
        );
    });

    it("fallback Cliente Instagram sem phone", () => {
        assert.equal(
            threadDisplayName({ channel: "instagram", profileName: null, phoneE164: null }),
            "Cliente Instagram"
        );
        assert.equal(
            threadDisplayName({ channel: "messenger", profileName: "", phoneE164: null }),
            "Cliente Messenger"
        );
    });

    it("badge e subtítulo por canal", () => {
        assert.equal(channelBadgeLabel("instagram"), "IG");
        assert.equal(channelBadgeLabel("messenger"), "FB");
        assert.match(
            threadDisplaySubtitle({
                channel: "instagram",
                externalId: "17841400000000000",
            }),
            /^IG · /
        );
    });
});
