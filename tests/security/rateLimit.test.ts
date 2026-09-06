import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    checkRateLimit,
    checkRateLimitByIp,
    enforceIpRateLimit,
    enforceKeyRateLimitAsync,
    requesterIp,
    resetRateLimitForTests,
} from "../../lib/security/rateLimit";
import {
    checkRateLimitAsync,
    isDistributedRateLimitEnabled,
} from "../../lib/security/rateLimitDistributed";
import {
    AGENT_POLL_LIMIT,
    enforceAgentRateLimit,
} from "../../lib/agent/enforceAgentRateLimit";

describe("requesterIp", () => {
    it("usa o primeiro hop de X-Forwarded-For", () => {
        const req = new Request("https://example.com", {
            headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
        });
        assert.equal(requesterIp(req), "203.0.113.1");
    });

    it("cai em X-Real-IP quando não há XFF", () => {
        const req = new Request("https://example.com", {
            headers: { "x-real-ip": "198.51.100.2" },
        });
        assert.equal(requesterIp(req), "198.51.100.2");
    });

    it("retorna unknown sem headers de IP", () => {
        assert.equal(requesterIp(new Request("https://example.com")), "unknown");
    });
});

describe("checkRateLimit", () => {
    beforeEach(() => resetRateLimitForTests());

    it("permite até o limite dentro da janela", () => {
        for (let i = 0; i < 3; i++) {
            const rl = checkRateLimit("test:key", 3, 60_000);
            assert.equal(rl.allowed, true);
        }
        const blocked = checkRateLimit("test:key", 3, 60_000);
        assert.equal(blocked.allowed, false);
        assert.ok(blocked.retryAfterSeconds >= 1);
    });

    it("isola buckets por chave", () => {
        assert.equal(checkRateLimit("a", 1, 60_000).allowed, true);
        assert.equal(checkRateLimit("b", 1, 60_000).allowed, true);
        assert.equal(checkRateLimit("a", 1, 60_000).allowed, false);
        assert.equal(checkRateLimit("b", 1, 60_000).allowed, false);
    });
});

describe("checkRateLimitByIp", () => {
    beforeEach(() => resetRateLimitForTests());

    it("prefixa a chave com o IP", () => {
        const req = new Request("https://example.com", {
            headers: { "x-real-ip": "10.0.0.5" },
        });
        assert.equal(checkRateLimitByIp("billing_signup", req, 2, 60_000).allowed, true);
        assert.equal(checkRateLimitByIp("billing_signup", req, 2, 60_000).allowed, true);
        assert.equal(checkRateLimitByIp("billing_signup", req, 2, 60_000).allowed, false);
    });
});

describe("enforceIpRateLimit", () => {
    beforeEach(() => resetRateLimitForTests());

    it("retorna null dentro do limite", () => {
        const req = new Request("https://example.com", {
            headers: { "x-real-ip": "10.0.0.9" },
        });
        assert.equal(enforceIpRateLimit(req, "auth_sync", 2, 60_000), null);
    });

    it("retorna Response 429 ao exceder", () => {
        const req = new Request("https://example.com", {
            headers: { "x-real-ip": "10.0.0.10" },
        });
        enforceIpRateLimit(req, "auth_sync", 1, 60_000);
        const res = enforceIpRateLimit(req, "auth_sync", 1, 60_000);
        assert.ok(res);
        assert.equal(res!.status, 429);
        const retryAfter = Number(res!.headers.get("Retry-After"));
        assert.ok(retryAfter >= 1 && retryAfter <= 60);
    });
});

describe("enforceKeyRateLimitAsync", () => {
    beforeEach(() => resetRateLimitForTests());

    it("bloqueia chave arbitrária após o limite", async () => {
        assert.equal(await enforceKeyRateLimitAsync("billing_signup_email:x", 1, 60_000), null);
        const blocked = await enforceKeyRateLimitAsync("billing_signup_email:x", 1, 60_000);
        assert.ok(blocked);
        assert.equal(blocked!.status, 429);
    });
});

describe("checkRateLimitAsync (sem Upstash)", () => {
    beforeEach(() => resetRateLimitForTests());

    it("sem env Upstash fica desligado e usa memória", async () => {
        assert.equal(isDistributedRateLimitEnabled(), false);
        assert.equal((await checkRateLimitAsync("async:a", 1, 60_000)).allowed, true);
        assert.equal((await checkRateLimitAsync("async:a", 1, 60_000)).allowed, false);
    });
});

describe("enforceAgentRateLimit", () => {
    beforeEach(() => resetRateLimitForTests());

    it("limita por agentId + op", () => {
        const agentId = "agent-uuid-1";
        for (let i = 0; i < AGENT_POLL_LIMIT; i++) {
            assert.equal(enforceAgentRateLimit(agentId, "poll", AGENT_POLL_LIMIT), null);
        }
        const blocked = enforceAgentRateLimit(agentId, "poll", AGENT_POLL_LIMIT);
        assert.ok(blocked);
        assert.equal(blocked!.status, 429);
        assert.equal(enforceAgentRateLimit("agent-uuid-2", "poll", AGENT_POLL_LIMIT), null);
        assert.equal(enforceAgentRateLimit(agentId, "reserve", 1), null);
    });
});
