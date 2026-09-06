import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("embedded-signup routes — gates", () => {
    const root = process.cwd();

    it("config e complete exigem owner/admin + feature whatsapp_messages", () => {
        const config = readFileSync(
            join(root, "app/api/admin/whatsapp-channel/embedded-signup/config/route.ts"),
            "utf8"
        );
        const complete = readFileSync(
            join(root, "app/api/admin/whatsapp-channel/embedded-signup/complete/route.ts"),
            "utf8"
        );
        assert.match(config, /requireCompanyPlanFeature\(\s*["']whatsapp_messages["']/);
        assert.match(config, /\["owner", "admin"\]/);
        assert.match(complete, /requireCompanyPlanFeature\(\s*["']whatsapp_messages["']/);
        assert.match(complete, /\["owner", "admin"\]/);
        assert.match(complete, /enforceKeyRateLimitAsync/);
        assert.doesNotMatch(complete, /company_id.*searchParams|body\.companyId/);
    });

    it("PUT paste do tenant foi removido (410)", () => {
        const src = readFileSync(join(root, "app/api/admin/whatsapp-channel/route.ts"), "utf8");
        assert.match(src, /tenant_paste_removed/);
        assert.match(src, /status: 410/);
        assert.doesNotMatch(src, /upsertWhatsappChannelCredentials\s*\(/);
    });
});
