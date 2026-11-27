import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    PROFILE_PIC_REFRESH_TTL_MS,
    sanitizeMetaProfilePicUrl,
    selectThreadsForProfilePicRefresh,
} from "../../lib/meta/profilePic";

describe("profilePic", () => {
    it("aceita só https curto", () => {
        assert.equal(sanitizeMetaProfilePicUrl("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg");
        assert.equal(sanitizeMetaProfilePicUrl("http://cdn.example/a.jpg"), null);
        assert.equal(sanitizeMetaProfilePicUrl("javascript:alert(1)"), null);
        assert.equal(sanitizeMetaProfilePicUrl(""), null);
    });

    it("escolhe IG/Messenger sem foto ou com foto vencida, no máximo 8", () => {
        const now = Date.parse("2026-11-27T12:00:00.000Z");
        const fresh = new Date(now - 60_000).toISOString();
        const stale = new Date(now - PROFILE_PIC_REFRESH_TTL_MS - 1).toISOString();
        const threads = [
            { id: "wa", channel: "whatsapp", external_id: "1", profile_pic_fetched_at: null },
            { id: "ig-fresh", channel: "instagram", external_id: "2", profile_pic_fetched_at: fresh },
            { id: "ig-stale", channel: "instagram", external_id: "3", profile_pic_fetched_at: stale },
            { id: "ig-missing", channel: "instagram", external_id: "4", profile_pic_fetched_at: null },
            { id: "ms-empty", channel: "messenger", external_id: "  ", profile_pic_fetched_at: null },
        ];
        const picked = selectThreadsForProfilePicRefresh(threads, now);
        assert.deepEqual(
            picked.map((t) => t.id),
            ["ig-stale", "ig-missing"]
        );
    });
});
