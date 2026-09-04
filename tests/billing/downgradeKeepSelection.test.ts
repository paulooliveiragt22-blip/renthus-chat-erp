import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateKeepUserSelection, effectiveChargePlanKey } from "@/lib/billing/validateKeepUserSelection";

describe("validateKeepUserSelection", () => {
    const members = [
        { user_id: "a", role: "owner", is_active: true },
        { user_id: "b", role: "member", is_active: true },
        { user_id: "c", role: "member", is_active: true },
    ];

    it("exige seleção quando excesso", () => {
        const r = validateKeepUserSelection({
            activeMembers: members,
            targetIncludedSeats: 1,
            keepUserIds: [],
        });
        assert.equal(r.ok, false);
    });

    it("exige admin na seleção", () => {
        const r = validateKeepUserSelection({
            activeMembers: members,
            targetIncludedSeats: 1,
            keepUserIds: ["b"],
        });
        assert.equal(r.ok, false);
    });

    it("aceita owner dentro do limite", () => {
        const r = validateKeepUserSelection({
            activeMembers: members,
            targetIncludedSeats: 1,
            keepUserIds: ["a"],
        });
        assert.equal(r.ok, true);
        if (r.ok) assert.deepEqual(r.keep_user_ids, ["a"]);
    });
});

describe("effectiveChargePlanKey", () => {
    it("usa pending quando set", () => {
        assert.equal(effectiveChargePlanKey("market", "pro"), "pro");
    });
    it("fallback plano atual", () => {
        assert.equal(effectiveChargePlanKey("market", null), "market");
    });
});
