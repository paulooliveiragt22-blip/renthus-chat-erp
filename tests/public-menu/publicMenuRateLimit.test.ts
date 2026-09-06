import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { NextRequest } from "next/server";
import {
    enforcePublicMenuRateLimit,
    publicMenuRateLimit,
    publicMenuRateLimitKey,
} from "../../lib/public-menu/publicApiHelpers";
import { resetRateLimitForTests } from "../../lib/security/rateLimit";

function reqWithIp(ip: string): NextRequest {
    return new NextRequest("https://example.com/api/public/menu/loja/checkout", {
        headers: { "x-real-ip": ip },
    });
}

describe("publicMenuRateLimit (B12 IP+slug)", () => {
    beforeEach(() => resetRateLimitForTests());

    it("chave inclui bucket, ip e slug", () => {
        assert.equal(
            publicMenuRateLimitKey("public_menu_checkout", "10.0.0.1", "loja-x"),
            "public_menu_checkout:10.0.0.1:loja-x"
        );
    });

    it("isola limites por slug no mesmo IP", async () => {
        const req = reqWithIp("203.0.113.9");
        assert.equal((await publicMenuRateLimit(req, "public_menu_checkout", "loja-a", 1)).allowed, true);
        assert.equal((await publicMenuRateLimit(req, "public_menu_checkout", "loja-a", 1)).allowed, false);
        assert.equal((await publicMenuRateLimit(req, "public_menu_checkout", "loja-b", 1)).allowed, true);
    });

    it("enforce retorna 429 com Retry-After", async () => {
        const req = reqWithIp("198.51.100.7");
        assert.equal(await enforcePublicMenuRateLimit(req, "public_menu", "loja", 1), null);
        const blocked = await enforcePublicMenuRateLimit(req, "public_menu", "loja", 1);
        assert.ok(blocked);
        assert.equal(blocked!.status, 429);
        assert.ok(Number(blocked!.headers.get("Retry-After")) >= 1);
        const body = (await blocked!.json()) as { error: string };
        assert.equal(body.error, "rate_limit_exceeded");
    });
});
