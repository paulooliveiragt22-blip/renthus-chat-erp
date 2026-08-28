import { NextRequest, NextResponse } from "next/server";
import { toAuditCtx, withPlatformAccess } from "@/lib/platform/apiHelpers";
import {
    getPlatformBillingSettings,
    updatePlatformBillingSettings,
} from "@/lib/platform/services/platformBillingSettings";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.billing.read", async (ctx) => {
        const settings = await getPlatformBillingSettings(ctx.admin);
        return NextResponse.json({ settings });
    });
}

export async function PATCH(request: NextRequest) {
    return withPlatformAccess("platform.billing.write", async (ctx) => {
        const body = (await request.json().catch(() => ({}))) as {
            default_trial_days?: unknown;
        };

        if (body.default_trial_days == null) {
            return NextResponse.json(
                { error: "default_trial_days é obrigatório" },
                { status: 400 }
            );
        }

        const n = Number(body.default_trial_days);
        if (!Number.isFinite(n)) {
            return NextResponse.json(
                { error: "default_trial_days deve ser um número entre 0 e 90" },
                { status: 400 }
            );
        }

        try {
            const settings = await updatePlatformBillingSettings(
                ctx.admin,
                toAuditCtx(ctx),
                n
            );
            return NextResponse.json({ settings });
        } catch (e) {
            return NextResponse.json(
                { error: e instanceof Error ? e.message : "Erro ao salvar" },
                { status: 400 }
            );
        }
    });
}
