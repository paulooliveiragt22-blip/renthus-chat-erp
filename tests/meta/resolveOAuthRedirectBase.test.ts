import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveOAuthRedirectBase } from "@/lib/meta/resolveOAuthRedirectBase";

describe("resolveOAuthRedirectBase", () => {
    it("prefere Host da request quando allowlisted", () => {
        const req = new Request("https://ignored.example/api", {
            headers: {
                host: "app.zampell.com.br",
                "x-forwarded-proto": "https",
            },
        });
        assert.equal(
            resolveOAuthRedirectBase(req, {
                NEXT_PUBLIC_APP_URL: "https://wrong.vercel.app",
                VERCEL_URL: "wrong.vercel.app",
            }),
            "https://app.zampell.com.br"
        );
    });

    it("cai no fallback se Host não está na allowlist", () => {
        const req = new Request("https://ignored.example/api", {
            headers: { host: "evil.example" },
        });
        assert.equal(
            resolveOAuthRedirectBase(req, {
                NEXT_PUBLIC_APP_URL: "https://app.zampell.com.br",
            }),
            "https://app.zampell.com.br"
        );
    });
});
