// app/api/auth/signout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST() {
    try {
        // Tenta remover sessão server-side (se existir)
        try {
            const supabase = await createClient();
            // signOut via server helper — em muitos cenários isso limpa cookies
            await supabase.auth.signOut();
        } catch (e) {
            // não falhar a resposta por conta disso — só logamos
            console.warn("Server-side supabase.auth.signOut() failed:", e);
        }

        // Limpa cookie de workspace
        cookies().delete("renthus_company_id", { path: "/" });

        // Opcional: remover outros cookies relevantes (sessão) é tratado por supabase.auth.signOut()
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("Error in auth/signout:", err);
        return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
    }
}
