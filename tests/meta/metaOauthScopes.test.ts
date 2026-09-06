import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    evaluateGrantedMetaScopes,
    META_FORBIDDEN_TOKEN_SCOPES,
    META_MESSAGING_OAUTH_SCOPE_LIST,
    META_MESSAGING_OAUTH_SCOPES,
    META_WHATSAPP_REQUIRED_SCOPES,
} from "../../lib/meta/metaOauthScopes";

describe("metaOauthScopes (S14)", () => {
    it("OAuth string = lista canônica sem escopos extras", () => {
        assert.equal(META_MESSAGING_OAUTH_SCOPES, META_MESSAGING_OAUTH_SCOPE_LIST.join(","));
        assert.ok(!META_MESSAGING_OAUTH_SCOPE_LIST.some((s) => s.startsWith("ads_")));
    });

    it("messaging: grant completo + alias IG passa", () => {
        const granted = [
            ...META_MESSAGING_OAUTH_SCOPE_LIST.filter((s) => s !== "instagram_basic"),
            "instagram_business_basic",
            "public_profile",
        ];
        const v = evaluateGrantedMetaScopes(granted, "messaging");
        assert.equal(v.ok, true);
        assert.deepEqual(v.forbidden, []);
        assert.deepEqual(v.missing, []);
    });

    it("messaging: falta pages_messaging e tem ads_management", () => {
        const v = evaluateGrantedMetaScopes(
            ["pages_show_list", "ads_management"],
            "messaging"
        );
        assert.equal(v.ok, false);
        assert.ok(v.forbidden.includes("ads_management"));
        assert.ok(v.missing.includes("pages_messaging"));
    });

    it("whatsapp: messaging basta; management não é obrigatório", () => {
        const v = evaluateGrantedMetaScopes(
            [...META_WHATSAPP_REQUIRED_SCOPES],
            "whatsapp"
        );
        assert.equal(v.ok, true);
        assert.ok(META_FORBIDDEN_TOKEN_SCOPES.includes("ads_management"));
    });

    it("whatsapp_embedded exige messaging + management", () => {
        const onlyMsg = evaluateGrantedMetaScopes(
            ["whatsapp_business_messaging"],
            "whatsapp_embedded"
        );
        assert.equal(onlyMsg.ok, false);
        assert.ok(onlyMsg.missing.includes("whatsapp_business_management"));
        const both = evaluateGrantedMetaScopes(
            ["whatsapp_business_messaging", "whatsapp_business_management"],
            "whatsapp_embedded"
        );
        assert.equal(both.ok, true);
    });
});
