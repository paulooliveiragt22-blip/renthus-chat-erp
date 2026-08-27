import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    resolveChannelAccessToken,
    resolveChannelWabaId,
} from "@/lib/whatsapp/channelCredentials";
import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";
import type { WhatsappTemplatePublic } from "@/src/domain/contracts/whatsappTemplates";
import { WhatsappTemplateStatusSchema } from "@/src/domain/contracts/whatsappTemplates";

const GRAPH_BASE =
    process.env.WHATSAPP_BASE_URL?.replace(/\/$/, "") ||
    "https://graph.facebook.com/v20.0";

export type ChannelCreds = {
    phoneNumberId: string;
    accessToken: string;
    wabaId: string;
    channelId: string;
};

export async function loadActiveWaChannelCreds(
    admin: SupabaseClient,
    companyId: string
): Promise<ChannelCreds | { error: string }> {
    const { data, error } = await admin
        .from("whatsapp_channels")
        .select("id, from_identifier, provider_metadata, encrypted_access_token, waba_id")
        .eq("company_id", companyId)
        .eq("provider", "meta")
        .eq("status", "active")
        .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "no_active_channel" };
    const accessToken = resolveChannelAccessToken(data);
    const wabaId = resolveChannelWabaId(data);
    const phoneNumberId = String(data.from_identifier ?? "").trim();
    if (!accessToken) return { error: "missing_access_token" };
    if (!phoneNumberId) return { error: "missing_phone_number_id" };
    if (!wabaId) return { error: "missing_waba_id" };
    return {
        channelId: data.id,
        phoneNumberId,
        accessToken,
        wabaId,
    };
}

function normalizeStatus(raw: unknown): string {
    const s = String(raw ?? "PENDING").toUpperCase();
    const parsed = WhatsappTemplateStatusSchema.safeParse(s);
    return parsed.success ? parsed.data : "PENDING";
}

function normalizeCategory(raw: unknown): "UTILITY" | "MARKETING" | "AUTHENTICATION" {
    const s = String(raw ?? "UTILITY").toUpperCase();
    if (s === "MARKETING" || s === "AUTHENTICATION") return s;
    return "UTILITY";
}

export function toPublicTemplate(row: {
    id: string;
    name: string;
    language: string;
    category: string;
    status: string;
    components: unknown;
    rejection_reason: string | null;
    meta_template_id: string | null;
    waba_id: string;
    last_synced_at: string | null;
}): WhatsappTemplatePublic {
    const components = Array.isArray(row.components)
        ? (row.components as Array<Record<string, unknown>>)
        : [];
    return {
        id: row.id,
        name: row.name,
        language: row.language,
        category: normalizeCategory(row.category),
        status: normalizeStatus(row.status) as WhatsappTemplatePublic["status"],
        components,
        rejectionReason: row.rejection_reason,
        metaTemplateId: row.meta_template_id,
        wabaId: row.waba_id,
        lastSyncedAt: row.last_synced_at,
    };
}

type MetaTemplateNode = {
    id?: string;
    name?: string;
    language?: string;
    status?: string;
    category?: string;
    components?: unknown;
    rejected_reason?: string;
};

/**
 * Sincroniza templates do WABA Meta → espelho local (upsert por name+language).
 */
export async function syncTemplatesFromMeta(
    admin: SupabaseClient,
    companyId: string
): Promise<{ ok: true; synced: number } | { ok: false; error: string; hint?: string }> {
    const creds = await loadActiveWaChannelCreds(admin, companyId);
    if ("error" in creds) {
        return {
            ok: false,
            error: creds.error,
            hint:
                creds.error === "missing_waba_id"
                    ? "Informe o WABA ID em Configurações → Canais."
                    : undefined,
        };
    }

    const url =
        `${GRAPH_BASE}/${encodeURIComponent(creds.wabaId)}/message_templates` +
        `?limit=100&fields=id,name,language,status,category,components,rejected_reason`;

    const res = await metaGraphGetJson(creds.wabaId, url, {
        accessToken: creds.accessToken,
    });
    if (!res.ok) {
        const errObj = res.json?.error as { message?: string } | undefined;
        return {
            ok: false,
            error: errObj?.message ?? `graph_http_${res.status}`,
            hint: "Confira token, WABA ID e permissão whatsapp_business_management.",
        };
    }

    const data = (res.json?.data as MetaTemplateNode[] | undefined) ?? [];
    const now = new Date().toISOString();
    let synced = 0;

    for (const node of data) {
        const name = String(node.name ?? "").trim();
        const language = String(node.language ?? "pt_BR").trim() || "pt_BR";
        if (!name) continue;

        const payload = {
            company_id: companyId,
            waba_id: creds.wabaId,
            meta_template_id: node.id ? String(node.id) : null,
            name,
            language,
            category: normalizeCategory(node.category),
            status: normalizeStatus(node.status),
            components: Array.isArray(node.components) ? node.components : [],
            rejection_reason: node.rejected_reason
                ? String(node.rejected_reason)
                : null,
            last_synced_at: now,
            updated_at: now,
        };

        const { error } = await admin.from("whatsapp_message_templates").upsert(payload, {
            onConflict: "company_id,name,language",
        });
        if (error) {
            return { ok: false, error: error.message };
        }
        synced += 1;
    }

    return { ok: true, synced };
}
