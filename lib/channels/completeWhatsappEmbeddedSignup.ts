import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCoexistenceFinishEvent } from "@/src/domain/contracts/embeddedSignup";
import { exchangeEmbeddedSignupCode } from "@/lib/channels/exchangeEmbeddedSignupCode";
import { assertWhatsappEmbeddedSignupToken } from "@/lib/channels/debugWhatsappEmbeddedToken";
import { subscribeWabaToApp } from "@/lib/channels/subscribeWabaToApp";
import {
    fetchPhoneCoexistenceFlags,
    resolveWabaPhoneNumberId,
} from "@/lib/channels/resolveWabaPhoneNumberId";
import { registerCloudApiPhone } from "@/lib/channels/registerCloudApiPhone";
import { startCoexistenceDataSync } from "@/lib/channels/startCoexistenceDataSync";
import { probeWhatsappChannelHealth } from "@/lib/channels/probeWhatsappChannelHealth";
import { upsertWhatsappChannelCredentials } from "@/lib/channels/upsertWhatsappChannelCredentials";
import type { PublicWhatsappChannel } from "@/lib/whatsapp/channelCredentials";

export type CompleteEmbeddedSignupInput = {
    companyId: string;
    userId: string;
    code: string;
    event: string;
    wabaId: string;
    phoneNumberId?: string;
    displayPhone?: string | null;
    pin?: string;
};

export type CompleteEmbeddedSignupResult = {
    channel: PublicWhatsappChannel;
    created: boolean;
    coexistence: boolean;
};

export type EmbeddedSignupDeps = {
    exchangeCode: typeof exchangeEmbeddedSignupCode;
    assertToken: typeof assertWhatsappEmbeddedSignupToken;
    subscribe: typeof subscribeWabaToApp;
    resolvePhone: typeof resolveWabaPhoneNumberId;
    phoneFlags: typeof fetchPhoneCoexistenceFlags;
    registerPhone: typeof registerCloudApiPhone;
    startSync: typeof startCoexistenceDataSync;
    upsertChannel: typeof upsertWhatsappChannelCredentials;
    probeHealth: typeof probeWhatsappChannelHealth;
};

const defaultDeps: EmbeddedSignupDeps = {
    exchangeCode: exchangeEmbeddedSignupCode,
    assertToken: assertWhatsappEmbeddedSignupToken,
    subscribe: subscribeWabaToApp,
    resolvePhone: resolveWabaPhoneNumberId,
    phoneFlags: fetchPhoneCoexistenceFlags,
    registerPhone: registerCloudApiPhone,
    startSync: startCoexistenceDataSync,
    upsertChannel: upsertWhatsappChannelCredentials,
    probeHealth: probeWhatsappChannelHealth,
};

export async function completeWhatsappEmbeddedSignup(
    admin: SupabaseClient,
    input: CompleteEmbeddedSignupInput,
    deps: EmbeddedSignupDeps = defaultDeps
): Promise<CompleteEmbeddedSignupResult> {
    const wabaId = input.wabaId.trim();
    if (!wabaId) throw new Error("waba_id_required");

    const token = await deps.exchangeCode(input.code);
    await deps.assertToken(token.accessToken);

    const phone = await deps.resolvePhone({
        wabaId,
        accessToken: token.accessToken,
        preferredPhoneNumberId: input.phoneNumberId,
    });

    await deps.subscribe({ wabaId, accessToken: token.accessToken });

    const flags = await deps.phoneFlags({
        phoneNumberId: phone.phoneNumberId,
        accessToken: token.accessToken,
    });
    const coexistence =
        isCoexistenceFinishEvent(input.event) || flags.isOnBizApp === true;

    if (!coexistence) {
        await deps.registerPhone({
            phoneNumberId: phone.phoneNumberId,
            accessToken: token.accessToken,
            pin: input.pin,
        });
    }

    const expiresAt =
        token.expiresIn && token.expiresIn > 0
            ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
            : null;

    const upserted = await deps.upsertChannel(admin, {
        companyId: input.companyId,
        phoneNumberId: phone.phoneNumberId,
        accessToken: token.accessToken,
        wabaId,
        whatsappPhone: input.displayPhone ?? phone.displayPhone,
        actor: { kind: "company_user", userId: input.userId },
        provisioningMode: "embedded_signup",
        isOnBizApp: coexistence,
        tokenExpiresAt: expiresAt,
    });

    if (coexistence) {
        await deps.startSync({
            phoneNumberId: phone.phoneNumberId,
            accessToken: token.accessToken,
        });
    }

    try {
        await deps.probeHealth(admin, input.companyId);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[embedded-signup] health probe failed", { message: msg });
    }

    return {
        channel: upserted.channel,
        created: upserted.created,
        coexistence,
    };
}
