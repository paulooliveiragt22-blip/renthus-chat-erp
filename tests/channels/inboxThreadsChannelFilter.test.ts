import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("GET /api/whatsapp/threads — filtro de canal", () => {
    it("aplica parse + apply do chip no query", () => {
        const src = readFileSync(join(process.cwd(), "app/api/whatsapp/threads/route.ts"), "utf8");
        assert.match(src, /parseInboxChannelFilter/);
        assert.match(src, /inboxChannelSql/);
        assert.match(src, /searchParams\.get\(["']channel["']\)/);
    });
});
