import assert from "node:assert";
import { describe, it } from "node:test";
import {
    getPlatformAdminHost,
    isPlatformAdminHostAllowed,
    isPlatformDedicatedHostRequest,
    platformAdminCanonicalUrl,
    resolveRequestHostname,
} from "../../lib/platform/resolvePlatformRequestHost";

function headers(map: Record<string, string>) {
    return {
        get(name: string) {
            return map[name.toLowerCase()] ?? null;
        },
    };
}

describe("resolvePlatformRequestHost", () => {
    it("prefers x-forwarded-host over host", () => {
        assert.strictEqual(
            resolveRequestHostname(
                headers({
                    host: "app.renthus.com.br",
                    "x-forwarded-host": "platform.renthus.com.br",
                })
            ),
            "platform.renthus.com.br"
        );
    });

    it("strips port and lowercases", () => {
        assert.strictEqual(
            resolveRequestHostname(headers({ host: "Platform.Renthus.com.br:443" })),
            "platform.renthus.com.br"
        );
    });

    it("allows any host when PLATFORM_ADMIN_HOST unset", () => {
        const prev = process.env.PLATFORM_ADMIN_HOST;
        delete process.env.PLATFORM_ADMIN_HOST;
        try {
            assert.strictEqual(
                isPlatformAdminHostAllowed(headers({ host: "app.renthus.com.br" })),
                true
            );
            assert.strictEqual(getPlatformAdminHost(), "");
        } finally {
            if (prev === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prev;
        }
    });

    it("rejects wrong host when PLATFORM_ADMIN_HOST set", () => {
        const prev = process.env.PLATFORM_ADMIN_HOST;
        process.env.PLATFORM_ADMIN_HOST = "platform.renthus.com.br";
        try {
            assert.strictEqual(
                isPlatformAdminHostAllowed(headers({ host: "app.renthus.com.br" })),
                false
            );
            assert.strictEqual(
                isPlatformAdminHostAllowed(
                    headers({ host: "platform.renthus.com.br" })
                ),
                true
            );
            assert.strictEqual(
                platformAdminCanonicalUrl("/platform/login", "?x=1"),
                "https://platform.renthus.com.br/platform/login?x=1"
            );
            assert.strictEqual(
                isPlatformDedicatedHostRequest(
                    headers({ host: "platform.renthus.com.br" }),
                    "example.com"
                ),
                true
            );
            assert.strictEqual(
                isPlatformDedicatedHostRequest(
                    headers({ host: "app.renthus.com.br" }),
                    "example.com"
                ),
                false
            );
        } finally {
            if (prev === undefined) delete process.env.PLATFORM_ADMIN_HOST;
            else process.env.PLATFORM_ADMIN_HOST = prev;
        }
    });
});
