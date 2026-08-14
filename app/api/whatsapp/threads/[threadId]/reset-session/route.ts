import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

/**
 * POST /api/whatsapp/threads/:threadId/reset-session
 *
 * Encerra a sessão do agente PRO e limpa o carrinho de uma thread específica,
 * independente do estado do bot (`bot_active` não é alterado — é um botão
 * separado do toggle Bot). Reset = DELETE atômico de `chatbot_sessions`
 * (mesmo padrão já usado em `bot-toggle` ao reativar): `step`, `draft`/carrinho
 * e histórico da IA vivem todos na mesma linha, então apagar a linha é a forma
 * mais simples e segura de zerar tudo sem deixar estado parcial. Na próxima
 * mensagem, `getOrCreateSession` recria a sessão do zero.
 *
 * Também descarta (`status = "discarded"`) qualquer `abandoned_carts` em
 * aberto da thread, para não disparar recuperação de carrinho depois que o
 * admin já limpou manualmente.
 */
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    const { admin, companyId } = ctx;

    const { data: thread, error: fetchErr } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!thread) return NextResponse.json({ error: "thread_not_found" }, { status: 404 });

    const { error: deleteErr } = await admin
        .from("chatbot_sessions")
        .delete()
        .eq("thread_id", threadId)
        .eq("company_id", companyId);

    if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

    await admin
        .from("abandoned_carts")
        .update({ status: "discarded" })
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .in("status", ["open", "notified"]);

    return NextResponse.json({ ok: true });
}
