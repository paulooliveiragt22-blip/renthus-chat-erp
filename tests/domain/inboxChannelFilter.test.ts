import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyInboxChannelFilter,
    inboxChannelFilterQueryValue,
    inboxChannelSql,
    inboxFilterEmptyCopy,
    inboxFilterForThreadChannel,
    parseInboxChannelFilter,
    threadMatchesInboxFilter,
} from "@/src/domain/messaging/inboxChannelFilter";

describe("inboxChannelFilter", () => {
    it("parseia URL e aliases", () => {
        assert.equal(parseInboxChannelFilter(null), "all");
        assert.equal(parseInboxChannelFilter("wa"), "whatsapp");
        assert.equal(parseInboxChannelFilter("IG"), "meta");
        assert.equal(parseInboxChannelFilter("meta"), "meta");
        assert.equal(parseInboxChannelFilter("nope"), "all");
    });

    it("casa thread.channel com o chip", () => {
        assert.equal(threadMatchesInboxFilter("whatsapp", "whatsapp"), true);
        assert.equal(threadMatchesInboxFilter(null, "whatsapp"), true);
        assert.equal(threadMatchesInboxFilter("instagram", "whatsapp"), false);
        assert.equal(threadMatchesInboxFilter("messenger", "meta"), true);
        assert.equal(threadMatchesInboxFilter("whatsapp", "meta"), false);
        assert.equal(threadMatchesInboxFilter("instagram", "all"), true);
    });

    it("deep link escolhe o chip da thread", () => {
        assert.equal(inboxFilterForThreadChannel("instagram"), "meta");
        assert.equal(inboxFilterForThreadChannel(null), "whatsapp");
    });

    it("aplica PostgREST só quando o chip não é Todos", () => {
        assert.equal(inboxChannelFilterQueryValue("all"), null);
        assert.equal(inboxChannelFilterQueryValue("meta"), "meta");

        const calls: string[] = [];
        const query = {
            or(expr: string) {
                calls.push(`or:${expr}`);
                return this;
            },
            in(column: string, values: readonly string[]) {
                calls.push(`in:${column}:${values.join(",")}`);
                return this;
            },
        };
        assert.equal(inboxChannelSql("all").kind, "all");
        applyInboxChannelFilter(query, "all");
        assert.deepEqual(calls, []);
        applyInboxChannelFilter(query, "whatsapp");
        applyInboxChannelFilter(query, "meta");
        assert.deepEqual(calls, [
            "or:channel.eq.whatsapp,channel.is.null",
            "in:channel:instagram,messenger",
        ]);
    });

    it("empty copy por chip", () => {
        assert.equal(inboxFilterEmptyCopy("all", true), "Nenhum resultado.");
        assert.match(inboxFilterEmptyCopy("meta", false), /Instagram/);
    });
});
