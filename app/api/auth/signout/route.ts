// app/api/auth/signout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PLATFORM_IMPERSONATION_COOKIE } from "@/lib/platform/impersonation";

export const runtime = "nodejs";

export async function POST() {
    try {
        try {
            const supabase = await createClient();
            await supabase.auth.signOut();
        } catch (e: unknown) {
            console.warn("Server-side supabase.auth.signOut() failed:", e);
        }

        const jar = await cookies();
        jar.delete("renthus_company_id");
        // A6: não deixar contexto de suporte órfão após logout
        jar.delete(PLATFORM_IMPERSONATION_COOKIE);

        return NextResponse.json({ ok: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Internal error";
        console.error("Error in auth/signout:", err);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
