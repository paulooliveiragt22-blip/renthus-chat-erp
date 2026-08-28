import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGenericCustomerDisplayName } from "../../lib/meta/customerDisplayName";

describe("channelThreadProfile integration", () => {
    it("Cliente Instagram é genérico e deve pedir nome real", () => {
        assert.equal(isGenericCustomerDisplayName("Cliente Instagram"), true);
        assert.equal(isGenericCustomerDisplayName("Ana Costa"), false);
    });
});
