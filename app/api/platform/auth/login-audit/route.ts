import { NextResponse } from "next/server";
import { withPlatformAccess, toAuditCtx } from "@/lib/platform/apiHelpers";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";

export const runtime = "nodejs";

/** Registra login platform bem-sucedido (pós senha e/ou MFA aal2). */
export async function POST() {
    return withPlatformAccess(undefined, async (ctx) => {
        const audit = toAuditCtx(ctx);
        await recordPlatformAudit({
            admin: ctx.admin,
            actor: audit.actor,
            action: "platform.auth.login_success",
            resourceType: "platform_session",
            resourceId: ctx.actor.id,
            requestId: audit.requestId,
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent,
            metadata: { role: ctx.actor.role },
        });
        return NextResponse.json({ ok: true });
    });
}
