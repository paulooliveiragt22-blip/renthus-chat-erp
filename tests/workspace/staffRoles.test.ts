import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    canChangeMemberRole,
    canDeactivateMember,
    canInviteRole,
    inviteableRolesFor,
    normalizeCompanyRole,
} from "../../lib/workspace/staffRoles";
import {
    hasCapability,
    normalizeCapabilities,
} from "../../lib/workspace/rbac/capabilities";
import { DEFAULT_PROFILE_SEEDS, templateLabel } from "../../lib/workspace/rbac/profileTemplates";

describe("staff roles (RBAC)", () => {
    it("normalize e inviteable", () => {
        assert.equal(normalizeCompanyRole("Admin"), "admin");
        assert.equal(normalizeCompanyRole("staff"), "member");
        assert.equal(normalizeCompanyRole("x"), null);
        assert.deepEqual(inviteableRolesFor("owner"), ["admin", "member"]);
        assert.deepEqual(inviteableRolesFor("admin"), ["member"]);
        assert.deepEqual(inviteableRolesFor("member"), []);
        assert.equal(canInviteRole("owner", "admin"), true);
        assert.equal(canInviteRole("admin", "admin"), false);
        assert.equal(canInviteRole("owner", "owner"), false);
    });

    it("admin não rebaixa owner; ninguém promove a owner", () => {
        assert.equal(
            canChangeMemberRole({
                actorRole: "admin",
                targetRole: "owner",
                nextRole: "member",
                isSelf: false,
            }),
            false
        );
        assert.equal(
            canChangeMemberRole({
                actorRole: "owner",
                targetRole: "admin",
                nextRole: "owner",
                isSelf: false,
            }),
            false
        );
        assert.equal(
            canChangeMemberRole({
                actorRole: "owner",
                targetRole: "admin",
                nextRole: "member",
                isSelf: false,
            }),
            true
        );
    });

    it("desativar: não self, não owner", () => {
        assert.equal(
            canDeactivateMember({ actorRole: "owner", targetRole: "member", isSelf: true }),
            false
        );
        assert.equal(
            canDeactivateMember({ actorRole: "owner", targetRole: "owner", isSelf: false }),
            false
        );
        assert.equal(
            canDeactivateMember({ actorRole: "admin", targetRole: "admin", isSelf: false }),
            false
        );
        assert.equal(
            canDeactivateMember({ actorRole: "admin", targetRole: "member", isSelf: false }),
            true
        );
    });
});

describe("capabilities catalog", () => {
    it("normalize e hasCapability", () => {
        assert.deepEqual(normalizeCapabilities(["pdv.access", "pdv.access", "x"]), ["pdv.access"]);
        assert.equal(hasCapability(["pdv.access"], "pdv.access"), true);
        assert.equal(hasCapability(["kitchen.view"], "pdv.access"), false);
        assert.equal(hasCapability(["orders.read", "orders.write"], ["orders.write"], "all"), true);
    });

    it("templates padrão", () => {
        assert.equal(templateLabel("cashier"), "Atendente / Caixa");
        assert.equal(DEFAULT_PROFILE_SEEDS.length, 4);
        assert.ok(DEFAULT_PROFILE_SEEDS.every((s) => s.capabilities.length > 0));
    });
});
