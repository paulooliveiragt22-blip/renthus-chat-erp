import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

/**
 * Endpoint para marcar uma thread do WhatsApp como lida para o usuário atual.
 *
 * Este endpoint recebe um POST na rota /api/whatsapp/threads/[id]/read e
 * registra ou atualiza o registro em whatsapp_thread_reads, indicando que o
 * usuário leu mensagens até o momento atual. Ele utiliza requireCompanyAccess
 * para garantir que o usuário pertence à empresa e atualiza last_read_at.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }
    const { admin, companyId, userId } = ctx;
    const threadId = params.id;
    if (!threadId) {
        return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
    }
    try {
        // Upsert: se já existir registro de leitura, atualiza last_read_at; senão, cria.
        const { error: upsertError } = await admin
            .from("whatsapp_thread_reads")
            .upsert({
                company_id: companyId,
                user_id: userId,
                thread_id: threadId,
                last_read_at: new Date().toISOString(),
            }, { onConflict: "company_id,user_id,thread_id" });
        if (upsertError) {
            throw upsertError;
        }
        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Failed to mark read" }, { status: 500 });
    }
}