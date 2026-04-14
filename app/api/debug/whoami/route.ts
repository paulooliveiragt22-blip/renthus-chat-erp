import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function whoamiDisabledInProd(): boolean {
    const prod =
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    return prod && process.env.DEBUG_WHOAMI_ENABLED !== "true";
}

export async function GET() {
    if (whoamiDisabledInProd()) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supabase = await createServerClient();
    const { data: u, error } = await supabase.auth.getUser();

    if (error || !u?.user) return NextResponse.json({ logged_in: false, error: error?.message }, { status: 401 });

    const admin = createAdminClient();
    const { data: memberships } = await admin
        .from("company_users")
        .select("company_id, role, is_active")
        .eq("user_id", u.user.id);

    return NextResponse.json({
        logged_in: true,
        user_id: u.user.id,
        email: u.user.email,
        memberships: memberships ?? [],
    });
}
