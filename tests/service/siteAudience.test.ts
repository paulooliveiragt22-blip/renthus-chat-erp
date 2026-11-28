import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSiteAudienceDays } from "../../src/service/domain/siteAudience";

describe("período do acesso ao site", () => {
    it("aceita hoje, 7 e 30 dias", () => {
        assert.equal(parseSiteAudienceDays(null), 1);
        assert.equal(parseSiteAudienceDays("1"), 1);
        assert.equal(parseSiteAudienceDays("7"), 7);
        assert.equal(parseSiteAudienceDays("30"), 30);
        assert.equal(parseSiteAudienceDays("90"), 1);
    });
});
