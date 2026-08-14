import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";

export const runtime = "nodejs";

export async function GET(
    req: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) {
        return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    const { admin, companyId } = ctx;

    // garante que a thread pertence à empresa
    const { data: thread } = await admin
        .from("whatsapp_threads")
        .select("id")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();

    if (!thread) {
        return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const url = new URL(req.url);
    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    /**
     * Sem `.order(desc) + limit` aqui, threads com mais mensagens que o limite padrão do
     * PostgREST (1000 linhas) retornavam só as MAIS ANTIGAS (ordenadas asc sem limit corta
     * do fim) — a caixa mostrava uma conversa "congelada" no passado enquanto a lista de
     * threads (que lê `last_message_at`/`last_message_preview` direto da própria thread)
     * já refletia a mensagem mais recente. Buscamos as últimas `limit` mensagens (desc) e
     * devolvemos em ordem cronológica (asc), que é o que a UI espera pra renderizar.
     */
    const { data, error } = await admin
        .from("whatsapp_messages")
        .select(
            "id, direction, provider, from_addr, to_addr, body, status, created_at, num_media, raw_payload"
        )
        .eq("thread_id", threadId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const messages = (data ?? []).slice().reverse();
    return NextResponse.json({ messages });
}
