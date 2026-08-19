import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ORDER_NOTES_MAX_LEN, sanitizeOrderNotes } from "@/lib/orders/sanitizeOrderNotes";

describe("sanitizeOrderNotes", () => {
    it("trim e vazio vira null", () => {
        assert.equal(sanitizeOrderNotes("  "), null);
        assert.equal(sanitizeOrderNotes(null), null);
        assert.equal(sanitizeOrderNotes("sem alface"), "sem alface");
    });

    it("colapsa espaços e corta no teto", () => {
        assert.equal(sanitizeOrderNotes("hambúrguer   sem   alface"), "hambúrguer sem alface");
        const long = "x".repeat(ORDER_NOTES_MAX_LEN + 40);
        const out = sanitizeOrderNotes(long);
        assert.equal(out?.length, ORDER_NOTES_MAX_LEN);
    });
});
