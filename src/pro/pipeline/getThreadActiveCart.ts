/**
 * Leitura (read model) do carrinho ativo de uma thread — usado pela inbox admin pra
 * mostrar ao atendente humano o que o cliente já tinha montado com o bot, sem precisar
 * perguntar tudo de novo. Espelha o estilo de `applyHandover.ts` (função + params object,
 * sem port/adapter dedicado — é um único leitor, não uma dependência trocável por provider).
 *
 * Importante: nunca usar `getOrCreateSession` aqui — tem efeito colateral de criar sessão
 * vazia só por o agente ter aberto a conversa. Esta função é 100% leitura.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftAddress, OrderDraft, PaymentMethod, ProStep } from "@/src/types/contracts";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";

export type ActiveCartItemView = {
    produtoEmbalagemId: string;
    productName: string;
    /** Sigla comercial (UN/CX/FARD/PAC) — null se a embalagem não existir mais no catálogo. */
    sigla: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
};

export type ActiveCartView = {
    /** `live_session`: sessão do bot ainda ativa. `abandoned`: sessão expirou, sobrou o snapshot de abandono. */
    source: "live_session" | "abandoned";
    step: ProStep | null;
    stepLabel: string;
    items: ActiveCartItemView[];
    totalItems: number;
    grandTotal: number;
    paymentMethod: PaymentMethod | null;
    address: DraftAddress | null;
    updatedAt: string | null;
};

const STEP_LABELS: Record<ProStep, string> = {
    pro_idle: "Sem pedido em andamento",
    pro_collecting_order: "Cliente ainda montando o carrinho",
    pro_awaiting_address_confirmation: "Aguardando confirmação do endereço",
    pro_awaiting_payment_method: "Aguardando forma de pagamento",
    pro_awaiting_change_amount: "Aguardando valor pro troco",
    pro_awaiting_confirmation: "Aguardando confirmação final do pedido",
    pro_awaiting_phone: "Aguardando telefone do cliente",
    pro_escalation_choice: "Cliente escolhendo tipo de atendimento",
    handover: "Em atendimento humano",
};

export type GetThreadActiveCartParams = {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
};

type StoredProState = { draft?: OrderDraft | null; step?: ProStep } | null | undefined;

export async function getThreadActiveCart(
    params: GetThreadActiveCartParams
): Promise<ActiveCartView | null> {
    const { admin, companyId, threadId } = params;

    const { data: session } = await admin
        .from("chatbot_sessions")
        .select("step, context, updated_at")
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

    const context = (session?.context ?? null) as Record<string, unknown> | null;
    const liveState = context?.[CHATBOT_SESSION_PRO_V2_STATE_KEY] as StoredProState;
    const liveDraft = liveState?.draft ?? null;

    if (liveDraft?.items?.length) {
        return buildView({
            admin,
            companyId,
            source: "live_session",
            step: liveState?.step ?? (session?.step as ProStep | null) ?? null,
            draft: liveDraft,
            updatedAt: (session?.updated_at as string | null) ?? null,
        });
    }

    const { data: abandoned } = await admin
        .from("abandoned_carts")
        .select("draft, detected_at")
        .eq("thread_id", threadId)
        .eq("company_id", companyId)
        .in("status", ["open", "notified"])
        .order("detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    const abandonedDraft = (abandoned?.draft ?? null) as OrderDraft | null;
    if (abandonedDraft?.items?.length) {
        return buildView({
            admin,
            companyId,
            source: "abandoned",
            step: null,
            draft: abandonedDraft,
            updatedAt: (abandoned?.detected_at as string | null) ?? null,
        });
    }

    return null;
}

async function buildView(args: {
    admin: SupabaseClient;
    companyId: string;
    source: ActiveCartView["source"];
    step: ProStep | null;
    draft: OrderDraft;
    updatedAt: string | null;
}): Promise<ActiveCartView> {
    const { admin, companyId, source, step, draft, updatedAt } = args;

    const ids = [...new Set(draft.items.map((it) => it.produtoEmbalagemId).filter(Boolean))];
    const siglaById = new Map<string, string>();
    if (ids.length) {
        const { data: rows } = await admin
            .from("view_pdv_produtos")
            .select("id, sigla_comercial")
            .eq("company_id", companyId)
            .in("id", ids);
        for (const r of rows ?? []) {
            siglaById.set(String(r.id), String(r.sigla_comercial ?? "UN").toUpperCase());
        }
    }

    const items: ActiveCartItemView[] = draft.items.map((it) => ({
        produtoEmbalagemId: it.produtoEmbalagemId,
        productName: it.productName,
        sigla: siglaById.get(it.produtoEmbalagemId) ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
    }));

    return {
        source,
        step,
        stepLabel: step ? STEP_LABELS[step] ?? step : "Carrinho abandonado (sessão expirou)",
        items,
        totalItems: draft.totalItems ?? items.reduce((s, i) => s + i.quantity, 0),
        grandTotal: draft.grandTotal ?? items.reduce((s, i) => s + i.subtotal, 0),
        paymentMethod: draft.paymentMethod ?? null,
        address: draft.address ?? null,
        updatedAt,
    };
}
