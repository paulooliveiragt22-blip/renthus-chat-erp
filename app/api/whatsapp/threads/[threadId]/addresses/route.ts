import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { jsonAccessError, jsonError, jsonInternalError } from "@/lib/api/errors";
import { resolveThreadCustomers } from "@/lib/whatsapp/resolveThreadCustomers";
import { loadServiceArea } from "@/lib/delivery/serviceArea";
import type { SavedCustomerAddress } from "@/lib/whatsapp/types";

export const runtime = "nodejs";

/**
 * GET /api/whatsapp/threads/:threadId/addresses
 *
 * Endereços já cadastrados do cliente da thread + cidade/UF que a empresa
 * atende — o atendente escolhe um em vez de redigitar na gaveta do carrinho.
 * Leitura server-side com o `company_id` da sessão (frontend não toca
 * `enderecos_cliente` direto).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ threadId: string }> }) {
    const { threadId } = await params;
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return jsonAccessError(ctx);
    const { admin, companyId } = ctx;

    const { data: thread, error: threadErr } = await admin
        .from("whatsapp_threads")
        .select("id, phone_e164")
        .eq("id", threadId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (threadErr) return jsonInternalError(threadErr, { route: "whatsapp/threads/:id/addresses:GET" });
    if (!thread) return jsonError("thread_not_found", "Conversa não encontrada.", 404);

    const defaults = await loadServiceArea(admin, companyId);

    const phone = thread.phone_e164 as string | null;
    if (!phone) return NextResponse.json({ addresses: [], defaults });

    let customerIds: string[];
    try {
        ({ customerIds } = await resolveThreadCustomers(admin, companyId, phone));
    } catch (err) {
        return jsonInternalError(err, { route: "whatsapp/threads/:id/addresses:GET", step: "customers" });
    }
    if (customerIds.length === 0) return NextResponse.json({ addresses: [], defaults });

    const { data, error } = await admin
        .from("enderecos_cliente")
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep, is_principal")
        .eq("company_id", companyId)
        .in("customer_id", customerIds)
        .order("is_principal", { ascending: false })
        .order("apelido", { ascending: true })
        .limit(20);
    if (error) return jsonInternalError(error, { route: "whatsapp/threads/:id/addresses:GET", step: "addresses" });

    const addresses: SavedCustomerAddress[] = (data ?? []).map((r) => ({
        id: String(r.id),
        apelido: String(r.apelido ?? "").trim() || "Entrega",
        logradouro: String(r.logradouro ?? "").trim(),
        numero: String(r.numero ?? "").trim(),
        complemento: String(r.complemento ?? "").trim(),
        bairro: String(r.bairro ?? "").trim(),
        cidade: String(r.cidade ?? "").trim(),
        estado: String(r.estado ?? "").trim().toUpperCase().slice(0, 2),
        cep: String(r.cep ?? "").trim(),
        isPrincipal: Boolean(r.is_principal),
    }));

    return NextResponse.json({ addresses, defaults });
}
