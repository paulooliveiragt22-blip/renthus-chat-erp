import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    canChangeMemberRole,
    canDeactivateMember,
    canInviteRole,
    inviteableRolesFor,
    normalizeCompanyRole,
} from "../../lib/workspace/staffRoles";

describe("staff roles (M3)", () => {
    it("normalize e inviteable", () => {
        assert.equal(normalizeCompanyRole("Admin"), "admin");
        assert.equal(normalizeCompanyRole("x"), null);
        assert.deepEqual(inviteableRolesFor("owner"), ["admin", "staff"]);
        assert.deepEqual(inviteableRolesFor("admin"), ["staff"]);
        assert.deepEqual(inviteableRolesFor("staff"), []);
        assert.equal(canInviteRole("owner", "admin"), true);
        assert.equal(canInviteRole("admin", "admin"), false);
        assert.equal(canInviteRole("owner", "owner"), false);
    });

    it("admin não rebaixa owner; ninguém promove a owner", () => {
        assert.equal(
            canChangeMemberRole({
                actorRole: "admin",
                targetRole: "owner",
                nextRole: "staff",
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
                nextRole: "staff",
                isSelf: false,
            }),
            true
        );
    });

    it("desativar: não self, não owner", () => {
        assert.equal(
            canDeactivateMember({ actorRole: "owner", targetRole: "staff", isSelf: true }),
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
            canDeactivateMember({ actorRole: "admin", targetRole: "staff", isSelf: false }),
            true
        );
    });
});
