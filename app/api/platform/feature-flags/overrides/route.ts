import { NextRequest, NextResponse } from "next/server";
import { toAuditCtx, withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    deleteFeatureFlagOverride,
    setFeatureFlagOverride,
} from "@/lib/platform/services/platformFeatureFlags";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
    return withPlatformAccess("platform.feature_flags.write", async (ctx) => {
        const body = (await request.json().catch(() => ({}))) as {
            key?: string;
            company_id?: string;
            enabled?: boolean;
        };
        if (!body.key || !body.company_id || typeof body.enabled !== "boolean") {
            return NextResponse.json(
                { error: "key, company_id e enabled obrigatórios" },
                { status: 400 }
            );
        }
        try {
            const override = await setFeatureFlagOverride(ctx.admin, toAuditCtx(ctx), {
                key: body.key,
                companyId: body.company_id,
                enabled: body.enabled,
            });
            return NextResponse.json({ override });
        } catch (e) {
            return NextResponse.json(
                { error: e instanceof Error ? e.message : "erro" },
                { status: 400 }
            );
        }
    });
}

export async function DELETE(request: NextRequest) {
    return withPlatformAccess("platform.feature_flags.write", async (ctx) => {
        const id = new URL(request.url).searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
        }
        try {
            await deleteFeatureFlagOverride(ctx.admin, toAuditCtx(ctx), id);
            return NextResponse.json({ ok: true });
        } catch (e) {
            return NextResponse.json(
                { error: e instanceof Error ? e.message : "erro" },
                { status: 400 }
            );
        }
    });
}
