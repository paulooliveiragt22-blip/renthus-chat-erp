import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";
import { encryptCredential } from "@/lib/security/credentialCrypto";
import { clampCatalogSyncIntervalHours } from "@/src/marketplaces/services/catalogSyncSchedule";

export const runtime = "nodejs";

function mapConnection(row: Record<string, unknown> | null) {
    if (!row) return null;
    return {
        companyId: String(row.company_id),
        provider: "aiqfome" as const,
        merchantId: String(row.merchant_id ?? ""),
        status: String(row.status ?? "disconnected"),
        useMock: Boolean(row.use_mock),
        hasAccessToken: Boolean(row.encrypted_access_token),
        autoSyncEnabled: Boolean(row.auto_sync_enabled),
        syncIntervalHours: clampCatalogSyncIntervalHours(row.sync_interval_hours),
        lastSyncAt: row.last_sync_at == null ? null : String(row.last_sync_at),
        lastError: row.last_error == null ? null : String(row.last_error),
        lastSync: {
            created: Number(row.last_sync_created ?? 0),
            updated: Number(row.last_sync_updated ?? 0),
            skipped: Number(row.last_sync_skipped ?? 0),
            imagesDownloaded: Number(row.last_sync_images ?? 0),
            errors: Number(row.last_sync_errors ?? 0),
        },
        updatedAt: String(row.updated_at ?? ""),
    };
}

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "marketplace_aiqfome");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("marketplace_connections")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "aiqfome")
        .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ connection: mapConnection(data as Record<string, unknown> | null) });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "marketplace_aiqfome");
    if (!feat.ok) return feat.response;

    const body = (await req.json().catch(() => ({}))) as {
        merchantId?: string;
        accessToken?: string | null;
        useMock?: boolean;
        autoSyncEnabled?: boolean;
        syncIntervalHours?: number;
    };

    const merchantId = typeof body.merchantId === "string" ? body.merchantId.trim() : "";
    // Aiqfome ainda é mock-only no adapter; força mock e desliga auto-sync.
    const useMock = true;

    let encrypted: string | null | undefined;
    if (typeof body.accessToken === "string" && body.accessToken.trim()) {
        encrypted = encryptCredential(body.accessToken.trim());
        if (!encrypted) {
            return NextResponse.json({ error: "encryption_unavailable" }, { status: 500 });
        }
    }

    const patch: Record<string, unknown> = {
        company_id: companyId,
        provider: "aiqfome",
        merchant_id: merchantId,
        use_mock: useMock,
        auto_sync_enabled: false,
        status: "connected",
        updated_at: new Date().toISOString(),
    };
    if (body.syncIntervalHours != null) {
        patch.sync_interval_hours = clampCatalogSyncIntervalHours(body.syncIntervalHours);
    }
    if (encrypted !== undefined) patch.encrypted_access_token = encrypted;

    const { data, error } = await admin
        .from("marketplace_connections")
        .upsert(patch, { onConflict: "company_id,provider" })
        .select("*")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, connection: mapConnection(data as Record<string, unknown>) });
}
