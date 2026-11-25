import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAttendanceMode, type AttendanceMode } from "@/src/service/domain/attendanceMode";
import {
    upsertWhatsappChannelCredentials,
    type UpsertWhatsappChannelResult,
} from "@/lib/channels/upsertWhatsappChannelCredentials";
import { invalidateWaConfig } from "@/lib/whatsapp/waConfigCache";

export type WhatsappMigrateOffer = {
    sourceName: string;
    sourceMode: AttendanceMode;
    targetMode: AttendanceMode;
};

export type AdministeredWhatsappChannel = {
    channelId: string;
    companyName: string;
    attendanceMode: AttendanceMode;
    phoneNumberId: string;
    displayPhone: string | null;
    isCurrent: boolean;
};

export type AdministeredWhatsappCatalog = {
    currentName: string;
    currentMode: AttendanceMode;
    channels: AdministeredWhatsappChannel[];
};

function asMode(value: unknown): AttendanceMode {
    return isAttendanceMode(value) ? value : "delivery";
}

async function isCompanyAdmin(
    admin: SupabaseClient,
    userId: string,
    companyId: string
): Promise<boolean> {
    const { data, error } = await admin
        .from("company_users")
        .select("role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle();
    if (error || !data?.is_active) return false;
    const role = String(data.role ?? "").toLowerCase();
    return role === "owner" || role === "admin";
}

/**
 * Oferece migração só quando o número já é de outra empresa e o mesmo usuário
 * administra as duas. Caso contrário devolve null e a rota mantém o aviso genérico.
 * Não move a linha.
 */
export async function describeWhatsappMigrateOffer(
    admin: SupabaseClient,
    userId: string,
    targetCompanyId: string,
    phoneNumberId: string
): Promise<WhatsappMigrateOffer | null> {
    const phone = phoneNumberId.trim();
    if (!phone) return null;

    const { data: channel, error } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("provider", "meta")
        .eq("from_identifier", phone)
        .maybeSingle();
    if (error || !channel?.company_id || channel.company_id === targetCompanyId) return null;

    const allowed = await isCompanyAdmin(admin, userId, channel.company_id);
    if (!allowed) return null;

    const { data: companies, error: companyError } = await admin
        .from("companies")
        .select("id, name, attendance_mode")
        .in("id", [channel.company_id, targetCompanyId]);
    if (companyError || !companies) return null;

    const source = companies.find((row) => row.id === channel.company_id);
    const target = companies.find((row) => row.id === targetCompanyId);
    if (!source || !target) return null;

    const sourceName = typeof source.name === "string" ? source.name.trim() : "";
    if (!sourceName) return null;

    return {
        sourceName,
        sourceMode: asMode(source.attendance_mode),
        targetMode: asMode(target.attendance_mode),
    };
}

export async function listAdministeredWhatsappChannels(
    admin: SupabaseClient,
    userId: string,
    currentCompanyId: string
): Promise<AdministeredWhatsappCatalog> {
    const { data: memberships, error: memberError } = await admin
        .from("company_users")
        .select("company_id, role, is_active")
        .eq("user_id", userId);
    if (memberError) throw new Error(memberError.message);

    const companyIds = (memberships ?? [])
        .filter((row) => row.is_active && (String(row.role ?? "").toLowerCase() === "owner" || String(row.role ?? "").toLowerCase() === "admin"))
        .map((row) => row.company_id)
        .filter((id): id is string => typeof id === "string");

    const { data: companies, error: companyError } = await admin
        .from("companies")
        .select("id, name, attendance_mode, whatsapp_phone")
        .in("id", companyIds.length > 0 ? companyIds : [currentCompanyId]);
    if (companyError) throw new Error(companyError.message);

    const { data: channels, error: channelError } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier")
        .eq("provider", "meta")
        .in("company_id", companyIds.length > 0 ? companyIds : [currentCompanyId]);
    if (channelError) throw new Error(channelError.message);

    const byCompany = new Map((companies ?? []).map((row) => [row.id, row]));
    const current = byCompany.get(currentCompanyId);
    const currentName = typeof current?.name === "string" && current.name.trim() ? current.name.trim() : "Este perfil";

    const listed = (channels ?? [])
        .map((channel) => {
            const company = byCompany.get(channel.company_id);
            const companyName = typeof company?.name === "string" ? company.name.trim() : "";
            const phoneNumberId = typeof channel.from_identifier === "string" ? channel.from_identifier : "";
            if (!channel.id || !companyName || !phoneNumberId) return null;
            const display = typeof company?.whatsapp_phone === "string" ? company.whatsapp_phone.trim() : "";
            return {
                channelId: channel.id,
                companyName,
                attendanceMode: asMode(company?.attendance_mode),
                phoneNumberId,
                displayPhone: display || null,
                isCurrent: channel.company_id === currentCompanyId,
            } satisfies AdministeredWhatsappChannel;
        })
        .filter((row): row is AdministeredWhatsappChannel => row !== null)
        .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.companyName.localeCompare(b.companyName, "pt-BR"));

    return {
        currentName,
        currentMode: asMode(current?.attendance_mode),
        channels: listed,
    };
}

function digits(value: string): string {
    return value.replace(/\D/g, "");
}

/**
 * Move o canal para a empresa da sessão. Threads, mensagens e clientes ficam
 * na empresa de origem.
 */
export async function migrateWhatsappChannel(
    admin: SupabaseClient,
    input: {
        companyId: string;
        userId: string;
        phoneNumberId: string;
        accessToken: string;
        wabaId: string | null;
        whatsappPhone: string | null;
    }
): Promise<UpsertWhatsappChannelResult> {
    const phone = input.phoneNumberId.trim();
    const { data: source, error } = await admin
        .from("whatsapp_channels")
        .select("id, company_id")
        .eq("provider", "meta")
        .eq("from_identifier", phone)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!source?.id || !source.company_id) throw new Error("channel_not_found");

    if (source.company_id !== input.companyId) {
        const allowed = await isCompanyAdmin(admin, input.userId, source.company_id);
        if (!allowed) throw new Error("migrate_forbidden");

        const { data: targetChannel, error: targetError } = await admin
            .from("whatsapp_channels")
            .select("id")
            .eq("company_id", input.companyId)
            .maybeSingle();
        if (targetError) throw new Error(targetError.message);
        if (targetChannel?.id && targetChannel.id !== source.id) {
            throw new Error("target_has_channel");
        }

        const { error: moveError } = await admin
            .from("whatsapp_channels")
            .update({ company_id: input.companyId })
            .eq("id", source.id)
            .eq("company_id", source.company_id);
        if (moveError) throw new Error(moveError.message);

        await admin.from("whatsapp_channel_credential_audit").insert({
            channel_id: source.id,
            company_id: source.company_id,
            action: "migrated_out",
            actor: `company_user:${input.userId}`,
            actor_kind: "company_user",
            actor_user_id: input.userId,
        });

        const displayDigits = input.whatsappPhone ? digits(input.whatsappPhone) : "";
        if (displayDigits.length >= 8) {
            const { data: sourceCompany } = await admin
                .from("companies")
                .select("whatsapp_phone")
                .eq("id", source.company_id)
                .maybeSingle();
            const current = typeof sourceCompany?.whatsapp_phone === "string" ? sourceCompany.whatsapp_phone : "";
            if (current && digits(current) === displayDigits) {
                await admin
                    .from("companies")
                    .update({ whatsapp_phone: null, updated_at: new Date().toISOString() })
                    .eq("id", source.company_id);
            }
        }
    }

    try {
        const result = await upsertWhatsappChannelCredentials(admin, {
            companyId: input.companyId,
            phoneNumberId: phone,
            accessToken: input.accessToken,
            wabaId: input.wabaId,
            whatsappPhone: input.whatsappPhone,
            actor: { kind: "company_user", userId: input.userId },
            provisioningMode: "tenant_paste",
        });
        if (source.company_id !== input.companyId) {
            invalidateWaConfig(source.company_id);
        }
        return result;
    } catch (err) {
        if (source.company_id !== input.companyId) {
            await admin
                .from("whatsapp_channels")
                .update({ company_id: source.company_id })
                .eq("id", source.id)
                .eq("company_id", input.companyId);
            invalidateWaConfig(source.company_id);
        }
        throw err;
    }
}

/** Move um canal que o usuário já administra para a empresa da sessão. O token permanece na linha. */
export async function migrateWhatsappChannelById(
    admin: SupabaseClient,
    input: { companyId: string; userId: string; channelId: string }
): Promise<{ channelId: string }> {
    const { data: source, error } = await admin
        .from("whatsapp_channels")
        .select("id, company_id")
        .eq("id", input.channelId)
        .eq("provider", "meta")
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!source?.id || !source.company_id) throw new Error("channel_not_found");
    if (source.company_id === input.companyId) throw new Error("already_current");

    const allowed = await isCompanyAdmin(admin, input.userId, source.company_id);
    if (!allowed) throw new Error("migrate_forbidden");
    const targetAllowed = await isCompanyAdmin(admin, input.userId, input.companyId);
    if (!targetAllowed) throw new Error("migrate_forbidden");

    const { data: targetChannel, error: targetError } = await admin
        .from("whatsapp_channels")
        .select("id")
        .eq("company_id", input.companyId)
        .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (targetChannel?.id) throw new Error("target_has_channel");

    const { data: sourceCompany } = await admin
        .from("companies")
        .select("whatsapp_phone")
        .eq("id", source.company_id)
        .maybeSingle();
    const displayPhone = typeof sourceCompany?.whatsapp_phone === "string" ? sourceCompany.whatsapp_phone.trim() : "";

    const { error: moveError } = await admin
        .from("whatsapp_channels")
        .update({ company_id: input.companyId })
        .eq("id", source.id)
        .eq("company_id", source.company_id);
    if (moveError) throw new Error(moveError.message);

    if (displayPhone) {
        await admin
            .from("companies")
            .update({ whatsapp_phone: displayPhone, updated_at: new Date().toISOString() })
            .eq("id", input.companyId);
        await admin
            .from("companies")
            .update({ whatsapp_phone: null, updated_at: new Date().toISOString() })
            .eq("id", source.company_id);
    }

    await admin.from("whatsapp_channel_credential_audit").insert([
        {
            channel_id: source.id,
            company_id: source.company_id,
            action: "migrated_out",
            actor: `company_user:${input.userId}`,
            actor_kind: "company_user",
            actor_user_id: input.userId,
        },
        {
            channel_id: source.id,
            company_id: input.companyId,
            action: "migrated_in",
            actor: `company_user:${input.userId}`,
            actor_kind: "company_user",
            actor_user_id: input.userId,
        },
    ]);

    invalidateWaConfig(source.company_id);
    invalidateWaConfig(input.companyId);
    return { channelId: source.id };
}
