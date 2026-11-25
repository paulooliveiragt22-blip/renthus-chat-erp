import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FEATURE_CHAPTERS } from "../../../lib/marketing/copy";
import { LANDING_LOOP_LIST, getLandingLoop } from "../../../lib/marketing/loops";

describe("loops da landpage", () => {
    it("aponta as quatro tomadas para mp4 em public/marketing/loops", () => {
        assert.equal(LANDING_LOOP_LIST.length, 4);
        const ids = LANDING_LOOP_LIST.map((loop) => loop.id);
        assert.deepEqual(new Set(ids).size, ids.length);
        for (const loop of LANDING_LOOP_LIST) {
            assert.match(loop.src, /^\/marketing\/loops\/[a-z0-9-]+\.mp4$/);
            assert.ok(loop.beats.length >= 3);
        }
        assert.equal(LANDING_LOOP_LIST[0]?.preload, "metadata");
    });

    it("amarra cada capítulo a uma tomada que existe", () => {
        for (const chapter of FEATURE_CHAPTERS) {
            assert.equal(getLandingLoop(chapter.loopId).id, chapter.loopId);
        }
    });
});
