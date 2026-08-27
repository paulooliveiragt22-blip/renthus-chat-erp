import { NextRequest, NextResponse } from "next/server";
import { toAuditCtx, withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    listFeatureFlags,
    upsertFeatureFlag,
} from "@/lib/platform/services/platformFeatureFlags";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.feature_flags.write", async (ctx) => {
        const flags = await listFeatureFlags(ctx.admin);
        return NextResponse.json({ flags });
    });
}

export async function PUT(request: NextRequest) {
    return withPlatformAccess("platform.feature_flags.write", async (ctx) => {
        const body = (await request.json().catch(() => ({}))) as {
            key?: string;
            description?: string;
            enabled_global?: boolean;
            metadata?: Record<string, unknown>;
        };
        if (!body.key || typeof body.enabled_global !== "boolean") {
            return NextResponse.json(
                { error: "key e enabled_global obrigatórios" },
                { status: 400 }
            );
        }
        try {
            const flag = await upsertFeatureFlag(ctx.admin, toAuditCtx(ctx), {
                key: body.key,
                description: body.description,
                enabled_global: body.enabled_global,
                metadata: body.metadata,
            });
            return NextResponse.json({ flag });
        } catch (e) {
            return NextResponse.json(
                { error: e instanceof Error ? e.message : "erro" },
                { status: 400 }
            );
        }
    });
}
