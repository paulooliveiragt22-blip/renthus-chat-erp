import { NextResponse } from "next/server";
import { requirePlatformAccess, platformAccessJson } from "@/lib/platform/requirePlatformAccess";
import { checkPlatformMfa } from "@/lib/platform/checkPlatformMfa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requirePlatformAccess(undefined, { skipMfa: true });
    if (!ctx.ok) {
        return NextResponse.json(platformAccessJson(ctx), { status: ctx.status });
    }

    const supabase = await createClient();
    const mfa = await checkPlatformMfa(supabase, ctx.actor.role, ctx.actor.mfaRequired);

    return NextResponse.json({
        user: {
            id: ctx.actor.id,
            email: ctx.actor.email,
            displayName: ctx.actor.displayName,
            role: ctx.actor.role,
            mfaRequired: ctx.actor.mfaRequired,
        },
        mfa: {
            satisfied: mfa.ok,
            aal: mfa.aal,
            required: ctx.actor.mfaRequired,
        },
    });
}
