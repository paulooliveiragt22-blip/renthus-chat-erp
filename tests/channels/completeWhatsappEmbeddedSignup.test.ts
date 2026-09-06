import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeWhatsappEmbeddedSignup } from "../../lib/channels/completeWhatsappEmbeddedSignup";
import type { EmbeddedSignupDeps } from "../../lib/channels/completeWhatsappEmbeddedSignup";
import type { PublicWhatsappChannel } from "../../lib/whatsapp/channelCredentials";

const channel: PublicWhatsappChannel = {
    id: "ch1",
    from_identifier: "1099",
    status: "active",
    provider_metadata: {},
    waba_id: "waba1",
    hasAccessToken: true,
    provisioning_mode: "embedded_signup",
    is_on_biz_app: true,
};

function deps(overrides: Partial<EmbeddedSignupDeps> = {}): EmbeddedSignupDeps {
    const calls = {
        register: 0,
        sync: 0,
        upsertMode: "" as string,
    };
    const base: EmbeddedSignupDeps = {
        exchangeCode: async () => ({ accessToken: "tok", expiresIn: null }),
        assertToken: async () => undefined,
        subscribe: async () => undefined,
        resolvePhone: async () => ({ phoneNumberId: "1099", displayPhone: "+5565" }),
        phoneFlags: async () => ({ isOnBizApp: true, platformType: "CLOUD_API" }),
        registerPhone: async () => {
            calls.register += 1;
        },
        startSync: async () => {
            calls.sync += 1;
            return { ok: true, failed: [] };
        },
        upsertChannel: async (_admin, input) => {
            calls.upsertMode = input.provisioningMode ?? "";
            return { created: true, channel };
        },
        probeHealth: async () => ({
            ok: true,
            checkedAt: new Date().toISOString(),
        }),
    };
    return Object.assign(base, overrides, { _calls: calls }) as EmbeddedSignupDeps & {
        _calls: typeof calls;
    };
}

describe("completeWhatsappEmbeddedSignup", () => {
    const admin = {} as SupabaseClient;

    it("Coexistence: não registra o número e dispara sync", async () => {
        const d = deps();
        const result = await completeWhatsappEmbeddedSignup(
            admin,
            {
                companyId: "c1",
                userId: "u1",
                code: "CODE12345",
                event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
                wabaId: "waba1",
            },
            d
        );
        assert.equal(result.coexistence, true);
        assert.equal(result.created, true);
        assert.equal((d as unknown as { _calls: { register: number; sync: number } })._calls.register, 0);
        assert.equal((d as unknown as { _calls: { register: number; sync: number } })._calls.sync, 1);
    });

    it("Cloud API puro: registra e não faz sync de histórico", async () => {
        const d = deps({
            phoneFlags: async () => ({ isOnBizApp: false, platformType: "CLOUD_API" }),
        });
        const result = await completeWhatsappEmbeddedSignup(
            admin,
            {
                companyId: "c1",
                userId: "u1",
                code: "CODE12345",
                event: "FINISH",
                wabaId: "waba1",
                phoneNumberId: "1099",
            },
            d
        );
        assert.equal(result.coexistence, false);
        assert.equal((d as unknown as { _calls: { register: number; sync: number } })._calls.register, 1);
        assert.equal((d as unknown as { _calls: { register: number; sync: number } })._calls.sync, 0);
    });
});
