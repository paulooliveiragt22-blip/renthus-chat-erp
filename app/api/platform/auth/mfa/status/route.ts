import { NextResponse } from "next/server";
import { requirePlatformAccess, platformAccessJson } from "@/lib/platform/requirePlatformAccess";
import {
    checkPlatformMfa,
    platformUserNeedsMfa,
} from "@/lib/platform/checkPlatformMfa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requirePlatformAccess(undefined, { skipMfa: true });
    if (!ctx.ok) {
        return NextResponse.json(platformAccessJson(ctx), { status: ctx.status });
    }

    const supabase = await createClient();
    const mfa = await checkPlatformMfa(supabase, ctx.actor.role, ctx.actor.mfaRequired);
    const required = platformUserNeedsMfa(ctx.actor.role, ctx.actor.mfaRequired);

    return NextResponse.json({
        required,
        satisfied: mfa.ok,
        currentLevel: mfa.aal,
        needsEnroll: mfa.ok ? false : mfa.needsEnroll,
    });
}
