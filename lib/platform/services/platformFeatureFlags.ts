import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import { isValidFeatureFlagKey } from "@/lib/platform/featureFlagKey";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";

export type PlatformOpsAuditCtx = {
    actor: PlatformActor;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

export { isValidFeatureFlagKey };

export type FeatureFlagRow = {
    key: string;
    description: string;
    enabled_global: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    overrides?: FeatureFlagOverrideRow[];
};

export type FeatureFlagOverrideRow = {
    id: string;
    company_id: string;
    key: string;
    enabled: boolean;
    created_at: string;
    updated_at: string;
    companies?: { id: string; name: string; slug: string | null } | null;
};

function normalizeCompanyEmbed(
    raw: unknown
): { id: string; name: string; slug: string | null } | null {
    if (!raw) return null;
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row || typeof row !== "object") return null;
    const o = row as { id?: unknown; name?: unknown; slug?: unknown };
    if (typeof o.id !== "string" || typeof o.name !== "string") return null;
    return {
        id: o.id,
        name: o.name,
        slug: typeof o.slug === "string" ? o.slug : null,
    };
}

function mapOverrideRow(row: Record<string, unknown>): FeatureFlagOverrideRow {
    return {
        id: String(row.id),
        company_id: String(row.company_id),
        key: String(row.key),
        enabled: Boolean(row.enabled),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
        companies: normalizeCompanyEmbed(row.companies),
    };
}

export async function listFeatureFlags(admin: SupabaseClient): Promise<FeatureFlagRow[]> {
    const { data: flags, error } = await admin
        .from("platform_feature_flags")
        .select("key, description, enabled_global, metadata, created_at, updated_at")
        .order("key", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: overrides, error: oErr } = await admin
        .from("platform_feature_flag_overrides")
        .select(
            "id, company_id, key, enabled, created_at, updated_at, companies(id, name, slug)"
        )
        .order("key", { ascending: true });
    if (oErr) throw new Error(oErr.message);

    const byKey = new Map<string, FeatureFlagOverrideRow[]>();
    for (const row of overrides ?? []) {
        const mapped = mapOverrideRow(row as Record<string, unknown>);
        const list = byKey.get(mapped.key) ?? [];
        list.push(mapped);
        byKey.set(mapped.key, list);
    }

    return (flags ?? []).map((f) => ({
        ...(f as FeatureFlagRow),
        metadata: (f.metadata ?? {}) as Record<string, unknown>,
        overrides: byKey.get(f.key) ?? [],
    }));
}

export async function upsertFeatureFlag(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    input: {
        key: string;
        description?: string;
        enabled_global: boolean;
        metadata?: Record<string, unknown>;
    }
): Promise<FeatureFlagRow> {
    const key = input.key.trim().toLowerCase();
    if (!isValidFeatureFlagKey(key)) {
        throw new Error("chave inválida (use a-z, 0-9, _ . - ; 2–64 chars)");
    }

    const { data: before } = await admin
        .from("platform_feature_flags")
        .select("key, description, enabled_global, metadata")
        .eq("key", key)
        .maybeSingle();

    const payload = {
        key,
        description: input.description?.trim() ?? before?.description ?? "",
        enabled_global: Boolean(input.enabled_global),
        metadata: input.metadata ?? before?.metadata ?? {},
        updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
        .from("platform_feature_flags")
        .upsert(payload, { onConflict: "key" })
        .select("key, description, enabled_global, metadata, created_at, updated_at")
        .single();
    if (error || !data) throw new Error(error?.message ?? "falha ao salvar flag");

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: before ? "platform.feature_flag.updated" : "platform.feature_flag.created",
        resourceType: "feature_flag",
        resourceId: key,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: before,
        afterState: data,
    });

    return { ...data, metadata: (data.metadata ?? {}) as Record<string, unknown>, overrides: [] };
}

export async function setFeatureFlagOverride(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    input: { key: string; companyId: string; enabled: boolean }
): Promise<FeatureFlagOverrideRow> {
    const key = input.key.trim().toLowerCase();
    if (!isValidFeatureFlagKey(key)) throw new Error("chave inválida");

    const { data: flag } = await admin
        .from("platform_feature_flags")
        .select("key")
        .eq("key", key)
        .maybeSingle();
    if (!flag) throw new Error("flag inexistente");

    const { data: before } = await admin
        .from("platform_feature_flag_overrides")
        .select("id, company_id, key, enabled")
        .eq("key", key)
        .eq("company_id", input.companyId)
        .maybeSingle();

    const now = new Date().toISOString();
    const { data, error } = await admin
        .from("platform_feature_flag_overrides")
        .upsert(
            {
                company_id: input.companyId,
                key,
                enabled: Boolean(input.enabled),
                updated_at: now,
            },
            { onConflict: "company_id,key" }
        )
        .select(
            "id, company_id, key, enabled, created_at, updated_at, companies(id, name, slug)"
        )
        .single();
    if (error || !data) throw new Error(error?.message ?? "falha ao salvar override");

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.feature_flag.override_set",
        resourceType: "feature_flag_override",
        resourceId: data.id,
        companyId: input.companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: before,
        afterState: { key, enabled: data.enabled },
    });

    return mapOverrideRow(data as Record<string, unknown>);
}

export async function deleteFeatureFlagOverride(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    overrideId: string
): Promise<void> {
    const { data: before, error: findErr } = await admin
        .from("platform_feature_flag_overrides")
        .select("id, company_id, key, enabled")
        .eq("id", overrideId)
        .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!before) throw new Error("override não encontrado");

    const { error } = await admin
        .from("platform_feature_flag_overrides")
        .delete()
        .eq("id", overrideId);
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.feature_flag.override_removed",
        resourceType: "feature_flag_override",
        resourceId: overrideId,
        companyId: before.company_id,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: before,
        afterState: null,
    });
}

/** Resolve flag (override empresa vence global). Flag inexistente = false. */
export async function isPlatformFeatureEnabled(
    admin: SupabaseClient,
    key: string,
    companyId?: string | null
): Promise<boolean> {
    const { data, error } = await admin.rpc("rpc_platform_is_feature_enabled", {
        p_key: key,
        p_company_id: companyId ?? null,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
}
