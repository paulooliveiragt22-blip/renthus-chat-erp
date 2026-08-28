import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMetaChannelUserProfileFromGraph } from "../../lib/meta/fetchMetaUserProfile";

describe("fetchMetaUserProfile", () => {
    it("instagram: prioriza name", () => {
        const profile = parseMetaChannelUserProfileFromGraph("instagram", {
            name: "Ana Costa",
            username: "ana.costa",
        });
        assert.equal(profile?.displayName, "Ana Costa");
        assert.equal(profile?.username, "ana.costa");
    });

    it("instagram: fallback para @username", () => {
        const profile = parseMetaChannelUserProfileFromGraph("instagram", {
            username: "loja.disk",
        });
        assert.equal(profile?.displayName, "@loja.disk");
    });

    it("messenger: concatena first_name e last_name", () => {
        const profile = parseMetaChannelUserProfileFromGraph("messenger", {
            first_name: "João",
            last_name: "Souza",
        });
        assert.equal(profile?.displayName, "João Souza");
    });

    it("retorna null sem campos úteis", () => {
        assert.equal(parseMetaChannelUserProfileFromGraph("instagram", {}), null);
        assert.equal(parseMetaChannelUserProfileFromGraph("messenger", {}), null);
    });
});
