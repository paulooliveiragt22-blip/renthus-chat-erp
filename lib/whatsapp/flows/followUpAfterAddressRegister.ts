/**
 * Após o Flow Meta salvar um endereço: sincroniza `__pro_v2_state` com o novo `enderecos_cliente`
 * e envia confirmação por botões (checkout PRO), em vez de encerrar o fluxo com texto solto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DraftAddress, ProSessionState } from "@/src/types/contracts";
import { getOrCreateSession, saveSession } from "@/lib/chatbot/session";
import { botSendButtons } from "@/lib/chatbot/botSend";
import { sendWhatsAppMessage, type WaConfig } from "@/lib/whatsapp/send";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";
import { resolveProStepFromDraft, isAddressStructurallyComplete } from "@/src/pro/pipeline/orderSlotStep";

function normalizeProState(raw: unknown): ProSessionState | null {
    if (raw === null || raw === undefined || typeof raw !== "object") return null;
    const o = raw as ProSessionState;
    return {
        ...o,
        searchProdutoEmbalagemIds: o.searchProdutoEmbalagemIds ?? [],
    };
}

function formatConfirmLine(addr: DraftAddress): string {
    return [addr.logradouro, addr.numero, addr.complemento, addr.bairroLabel ?? addr.bairro, addr.cidade, addr.estado, addr.cep]
        .filter(Boolean)
        .join(", ");
}

export async function followUpProSessionAfterAddressRegister(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    phoneE164: string;
    waConfig?: WaConfig;
    persistedAddressId: string;
}): Promise<void> {
    const { admin, companyId, threadId, phoneE164, waConfig, persistedAddressId } = params;

    const { data: row, error: rowErr } = await admin
        .from("enderecos_cliente")
        .select("id, apelido, logradouro, numero, complemento, bairro, cidade, estado, cep")
        .eq("id", persistedAddressId)
        .maybeSingle();

    if (rowErr || !row) {
        console.error("[followUpAfterAddressRegister] endereco nao encontrado:", rowErr?.message ?? persistedAddressId);
        await sendWhatsAppMessage(
            phoneE164,
            "Endereco cadastrado com sucesso! Ja pode enviar seu pedido por aqui.",
            waConfig
        );
        return;
    }

    const session = await getOrCreateSession(admin, threadId, companyId);
    const ctx: Record<string, unknown> = { ...(session.context ?? {}) };
    ctx.flow_address_register_done = true;
    ctx.registered_endereco_cliente_id = persistedAddressId;

    const proState = normalizeProState(ctx[CHATBOT_SESSION_PRO_V2_STATE_KEY]);
    const draftAddress: DraftAddress = {
        logradouro: String(row.logradouro ?? "").trim(),
        numero: String(row.numero ?? "").trim(),
        bairro: String(row.bairro ?? "").trim(),
        complemento: row.complemento ? String(row.complemento).trim() : null,
        apelido: row.apelido ? String(row.apelido).trim() : null,
        cidade: row.cidade ? String(row.cidade).trim() : null,
        estado: row.estado ? String(row.estado).trim().toUpperCase().slice(0, 2) : null,
        cep: row.cep ? String(row.cep).replace(/\D/g, "").slice(0, 8) || null,
        enderecoClienteId: String(row.id),
    };

    if (!proState?.draft?.items?.length || !isAddressStructurallyComplete(draftAddress)) {
        await saveSession(admin, threadId, companyId, { context: ctx });
        await sendWhatsAppMessage(
            phoneE164,
            "Endereco cadastrado com sucesso! Ja pode enviar seu pedido por aqui.",
            waConfig
        );
        return;
    }

    const nextDraft = {
        ...proState.draft,
        address: draftAddress,
        deliveryAddressText: null,
        addressResolutionNote: "address_register_flow",
    };
    const nextPro: ProSessionState = {
        ...proState,
        deliveryAddressUiConfirmed: false,
        draft: nextDraft,
        step: resolveProStepFromDraft({
            step: proState.step,
            draft: nextDraft,
            deliveryAddressUiConfirmed: false,
        }),
    };
    ctx[CHATBOT_SESSION_PRO_V2_STATE_KEY] = nextPro;

    await saveSession(admin, threadId, companyId, {
        context: ctx,
        step: nextPro.step,
        ...(session.customer_id != null ? { customer_id: session.customer_id } : {}),
    });

    const addrLine = formatConfirmLine(draftAddress);
    await botSendButtons(
        admin,
        companyId,
        threadId,
        phoneE164,
        `Endereco cadastrado! Confirma a entrega neste endereco?\n\n${addrLine}`,
        [
            { id: "pro_confirm_saved_address", title: "Confirmar" },
            { id: "pro_new_address_flow", title: "Novo endereco" },
        ],
        waConfig
    );
}
