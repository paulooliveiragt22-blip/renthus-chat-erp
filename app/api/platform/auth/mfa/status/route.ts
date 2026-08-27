import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPlatformMfa } from "@/lib/platform/checkPlatformMfa";
import { requirePlatformAccess, platformAccessJson } from "@/lib/platform/requirePlatformAccess";

export const runtime = "nodejs";

/** MFA assurance level — usado pela UI /platform/login/mfa */
export async function GET() {
    const ctx = await requirePlatformAccess(undefined, { skipMfa: true });
    if (!ctx.ok) {
        return NextResponse.json(platformAccessJson(ctx), { status: ctx.status });
    }

    const supabase = await createClient();
    const mfa = await checkPlatformMfa(supabase, ctx.actor.role, ctx.actor.mfaRequired);

    return NextResponse.json({
        currentLevel: mfa.aal,
        satisfied: mfa.ok,
        required: ctx.actor.mfaRequired,
    });
}
