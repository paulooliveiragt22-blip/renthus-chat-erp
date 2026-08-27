import { NextResponse } from "next/server";
import {
    platformAccessJson,
    requirePlatformAccess,
    type PlatformAccessDenied,
} from "@/lib/platform/requirePlatformAccess";
import type { PlatformPermission } from "@/lib/platform/platformPermissions";

export function deniedResponse(denied: PlatformAccessDenied) {
    return NextResponse.json(platformAccessJson(denied), { status: denied.status });
}

export async function withPlatformAccess(
    permission: PlatformPermission | undefined,
    handler: (ctx: Awaited<ReturnType<typeof requirePlatformAccess>> & { ok: true }) => Promise<Response>,
    opts?: { skipMfa?: boolean }
) {
    const ctx = await requirePlatformAccess(permission, opts);
    if (!ctx.ok) return deniedResponse(ctx);
    return handler(ctx);
}

export function toAuditCtx(ctx: {
    actor: import("@/lib/platform/requirePlatformAccess").PlatformActor;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
}) {
    return {
        actor: ctx.actor,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    };
}
