import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { whatsappTenantPasteBodySchema } from "../../src/domain/contracts/embeddedSignup";

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

    it("PUT paste do tenant exige a feature e não lê company_id do body", () => {
        const src = readFileSync(join(root, "app/api/admin/whatsapp-channel/route.ts"), "utf8");
        assert.match(src, /requireCompanyPlanFeature\(\s*["']whatsapp_messages["']/);
        assert.match(src, /upsertWhatsappChannelCredentials\s*\(/);
        assert.match(src, /provisioningMode:\s*["']tenant_paste["']/);
        assert.match(src, /enforceKeyRateLimitAsync/);
        assert.doesNotMatch(src, /tenant_paste_removed/);
        assert.doesNotMatch(src, /body\.companyId|body\.company_id/);
    });

    it("o corpo do paste recusa company_id e token curto", () => {
        const ok = whatsappTenantPasteBodySchema.safeParse({
            phoneNumberId: "109876543210",
            accessToken: "EAA" + "x".repeat(40),
            wabaId: "",
            displayPhone: "+5565999990000",
        });
        assert.equal(ok.success, true);
        const extra = whatsappTenantPasteBodySchema.safeParse({
            phoneNumberId: "109876543210",
            accessToken: "EAA" + "x".repeat(40),
            companyId: "0113a3fe-e224-49ff-81c6-f8b9df556267",
        });
        assert.equal(extra.success, false);
        const shortToken = whatsappTenantPasteBodySchema.safeParse({
            phoneNumberId: "109876543210",
            accessToken: "curto",
        });
        assert.equal(shortToken.success, false);
    });
});
