import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { tryCoalesceRedisLock, coalesceWindowSecondsForTests } from "../../lib/chatbot/queue/coalesceRedis";

describe("coalesceRedis", () => {
    const prev: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) {
            prev[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it("retorna unavailable sem Upstash configurado", async () => {
        const result = await tryCoalesceRedisLock("5511999999999::quero cerveja");
        assert.equal(result, "unavailable");
    });

    it("expõe janela de coalesce alinhada ao env default", () => {
        assert.equal(coalesceWindowSecondsForTests(), 20);
    });
});
