import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    encryptWaAccessToken,
    sanitizeWhatsappChannelForClient,
    stripProviderMetadataSecrets,
    type PublicWhatsappChannel,
} from "@/lib/whatsapp/channelCredentials";
import { invalidateWaConfig } from "@/lib/whatsapp/waConfigCache";

export type CredentialActor =
    | { kind: "platform"; userId: string }
    | { kind: "company_user"; userId: string };

export type UpsertWhatsappChannelInput = {
    companyId: string;
    phoneNumberId: string;
    accessToken?: string;
    wabaId?: string | null;
    whatsappPhone?: string | null;
    /** Se informado, atualiza canal existente por id; senão upsert por company. */
    channelId?: string;
    actor: CredentialActor;
    /** force encryption failure in prod instead of plaintext */
    requireEncryption?: boolean;
};

export type UpsertWhatsappChannelResult = {
    channel: PublicWhatsappChannel;
    created: boolean;
};

function isProd(): boolean {
    return (
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production"
    );
}

function actorLabel(actor: CredentialActor): string {
    return actor.kind === "platform"
        ? `platform:${actor.userId}`
        : `company_user:${actor.userId}`;
}

function provisioningMode(actor: CredentialActor): "platform" | "tenant_paste" {
    return actor.kind === "platform" ? "platform" : "tenant_paste";
}

function credentialSource(actor: CredentialActor): "platform_user" | "company_user" {
    return actor.kind === "platform" ? "platform_user" : "company_user";
}

/**
 * Cria ou atualiza canal WA Meta da empresa (shared: platform + tenant).
 * Em produção não grava plaintext se a chave de cifra estiver ausente.
 */
export async function upsertWhatsappChannelCredentials(
    admin: SupabaseClient,
    input: UpsertWhatsappChannelInput
): Promise<UpsertWhatsappChannelResult> {
    const phoneNumberId = input.phoneNumberId.trim();
    const tokenIn = input.accessToken?.trim() ?? "";
    const wabaId =
        input.wabaId === undefined
            ? undefined
            : input.wabaId === null
              ? null
              : input.wabaId.trim() || null;
    const requireEnc = input.requireEncryption ?? isProd();

    if (!phoneNumberId) {
        throw new Error("phone_number_id_required");
    }

    let existing: {
        id: string;
        encrypted_access_token: string | null;
        provider_metadata: unknown;
    } | null = null;

    if (input.channelId) {
        const { data, error } = await admin
            .from("whatsapp_channels")
            .select("id, encrypted_access_token, provider_metadata")
            .eq("id", input.channelId)
            .eq("company_id", input.companyId)
            .maybeSingle();
        if (error) throw new Error(error.message);
        existing = data;
        if (!existing) throw new Error("channel_not_found");
    } else {
        const { data, error } = await admin
            .from("whatsapp_channels")
            .select("id, encrypted_access_token, provider_metadata")
            .eq("company_id", input.companyId)
            .eq("provider", "meta")
            .maybeSingle();
        if (error) throw new Error(error.message);
        existing = data;
    }

    if (!existing && !tokenIn) {
        throw new Error("token_required");
    }

    let encrypted: string | null | undefined;
    if (tokenIn) {
        encrypted = encryptWaAccessToken(tokenIn);
        if (!encrypted) {
            if (requireEnc) throw new Error("encryption_unavailable");
            encrypted = null;
        }
    }

    const currentMeta =
        (existing?.provider_metadata as Record<string, unknown> | null) ?? {};
    const cleaned = stripProviderMetadataSecrets(currentMeta);

    const payload: Record<string, unknown> = {
        company_id: input.companyId,
        provider: "meta",
        status: "active",
        from_identifier: phoneNumberId,
        provisioning_mode: provisioningMode(input.actor),
        credential_source: credentialSource(input.actor),
    };

    if (wabaId !== undefined) {
        payload.waba_id = wabaId;
    }

    if (tokenIn) {
        if (encrypted) {
            payload.encrypted_access_token = encrypted;
            payload.provider_metadata = cleaned;
        } else {
            payload.encrypted_access_token = null;
            payload.provider_metadata = { ...cleaned, access_token: tokenIn };
        }
    }

    let row: Record<string, unknown>;
    let created = false;

    if (existing?.id) {
        const { data, error } = await admin
            .from("whatsapp_channels")
            .update(payload)
            .eq("id", existing.id)
            .select(
                "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
            )
            .single();
        if (error || !data) throw new Error(error?.message ?? "update_failed");
        row = data as Record<string, unknown>;
    } else {
        if (!tokenIn) throw new Error("token_required");
        const { data, error } = await admin
            .from("whatsapp_channels")
            .insert(payload)
            .select(
                "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
            )
            .single();
        if (error || !data) {
            if (error?.code === "23505") throw new Error("phone_number_id_conflict");
            throw new Error(error?.message ?? "insert_failed");
        }
        row = data as Record<string, unknown>;
        created = true;
    }

    await admin.from("whatsapp_channel_credential_audit").insert({
        channel_id: row.id,
        company_id: input.companyId,
        action: created ? "create_channel" : "update_credentials",
        actor: actorLabel(input.actor),
        actor_kind: input.actor.kind === "platform" ? "platform" : "company_user",
        actor_user_id: input.actor.userId,
    });

    invalidateWaConfig(input.companyId);

    if (input.whatsappPhone !== undefined && input.whatsappPhone !== null) {
        const phone = String(input.whatsappPhone).trim();
        if (phone) {
            await admin
                .from("companies")
                .update({ whatsapp_phone: phone, updated_at: new Date().toISOString() })
                .eq("id", input.companyId);
        }
    }

    return {
        created,
        channel: sanitizeWhatsappChannelForClient({
            id: String(row.id),
            company_id: input.companyId,
            from_identifier: String(row.from_identifier),
            status: String(row.status),
            provider_metadata: row.provider_metadata,
            encrypted_access_token: row.encrypted_access_token as string | null,
            waba_id: row.waba_id as string | null,
            created_at: row.created_at as string | undefined,
            provisioning_mode: row.provisioning_mode as string | undefined,
            credential_source: row.credential_source as string | undefined,
            last_health_at: row.last_health_at as string | null | undefined,
            last_health_ok: row.last_health_ok as boolean | null | undefined,
            last_health_error: row.last_health_error as string | null | undefined,
        }),
    };
}

export async function setWhatsappChannelStatus(
    admin: SupabaseClient,
    params: {
        companyId: string;
        status: "active" | "inactive";
        actor: CredentialActor;
    }
): Promise<PublicWhatsappChannel | null> {
    const { data: existing, error } = await admin
        .from("whatsapp_channels")
        .select(
            "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
        )
        .eq("company_id", params.companyId)
        .eq("provider", "meta")
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!existing) return null;

    const { data, error: upErr } = await admin
        .from("whatsapp_channels")
        .update({ status: params.status })
        .eq("id", existing.id)
        .select(
            "id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at, provisioning_mode, credential_source, last_health_at, last_health_ok, last_health_error"
        )
        .single();
    if (upErr || !data) throw new Error(upErr?.message ?? "status_update_failed");

    await admin.from("whatsapp_channel_credential_audit").insert({
        channel_id: data.id,
        company_id: params.companyId,
        action: params.status === "inactive" ? "deactivated" : "reactivated",
        actor: actorLabel(params.actor),
        actor_kind: params.actor.kind === "platform" ? "platform" : "company_user",
        actor_user_id: params.actor.userId,
    });

    invalidateWaConfig(params.companyId);

    return sanitizeWhatsappChannelForClient(data);
}
