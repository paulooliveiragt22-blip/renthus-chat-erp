import assert from "node:assert";
import { describe, it } from "node:test";
import { isUniqueViolation } from "../../lib/billing/isUniqueViolation";

describe("isUniqueViolation", () => {
    it("detects 23505", () => {
        assert.strictEqual(isUniqueViolation({ code: "23505" }), true);
    });

    it("detects message", () => {
        assert.strictEqual(
            isUniqueViolation({ message: "duplicate key value violates unique constraint" }),
            true
        );
    });

    it("rejects other errors", () => {
        assert.strictEqual(isUniqueViolation({ code: "42501", message: "permission" }), false);
        assert.strictEqual(isUniqueViolation(null), false);
    });
});
