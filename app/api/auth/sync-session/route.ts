import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const { access_token, refresh_token } = body ?? {};

    if (!access_token || !refresh_token) {
      return NextResponse.json({ error: "access_token and refresh_token are required" }, { status: 400 });
    }

    const supabase = await createServerClient();

    // setSession grava os cookies via createServerClient / cookie store
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });

    if (error) {
      console.error("auth.setSession error:", error);
      return NextResponse.json({ error: error.message || "Failed to set session" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Server error in auth/sync-session:", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
