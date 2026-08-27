import { NextRequest, NextResponse } from "next/server";
import { toAuditCtx, withPlatformAccess } from "@/lib/platform/apiHelpers";
import { invitePlatformUser } from "@/lib/platform/services/invitePlatformUser";
import { normalizePlatformRole } from "@/lib/platform/platformRoles";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
    return withPlatformAccess("platform.users.manage", async (ctx) => {
        const body = (await request.json().catch(() => ({}))) as {
            email?: string;
            display_name?: string;
            role?: string;
        };

        const role = normalizePlatformRole(body.role);
        if (!role) {
            return NextResponse.json({ error: "role inválida" }, { status: 400 });
        }

        const result = await invitePlatformUser({
            admin: ctx.admin,
            email: body.email ?? "",
            displayName: body.display_name ?? "",
            role,
            audit: toAuditCtx(ctx),
        });

        if (!result.ok) {
            return NextResponse.json(
                { error: result.error },
                { status: result.status }
            );
        }

        return NextResponse.json({
            ok: true,
            platformUserId: result.platformUserId,
            authUserId: result.authUserId,
            invited: result.invited,
        });
    });
}
