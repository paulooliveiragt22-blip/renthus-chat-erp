/**
 * Política única de merge de slots antes de `prepareOrderDraftFromTool` (ADR 0012 D3).
 *
 * Precedência:
 *   1. escolha explícita do fluxo (endereço salvo / botão / pick já resolvido)
 *   2. texto **deste** turno (envelope `InboundSlots`)
 *   3. rascunho atual
 *
 * Na direção inversa (anti-alucinação): valor que a LLM mandou só passa se tiver
 * respaldo no envelope ou no rascunho. Generaliza o antigo
 * `sanitizePreparePaymentAgainstUserText`, que cobria só pagamento/troco.
 */

import type {
    InboundSlots,
    OrderDraft,
    PrepareDraftToolInput,
} from "@/src/types/contracts";

export type SlotConflictCode = "address" | "payment" | "change";

function trimmed(value: unknown): string {
    return String(value ?? "").trim();
}

function hasStructuredAddress(input: PrepareDraftToolInput): boolean {
    const a = input.address;
    return Boolean(a && trimmed(a.logradouro) && trimmed(a.numero) && trimmed(a.bairro));
}

/** Endereço decidido pelo fluxo (não pela LLM interpretando texto). */
function hasFlowAddressChoice(input: PrepareDraftToolInput): boolean {
    return Boolean(trimmed(input.savedAddressId) || input.useSavedAddress);
}

function sameHouseNumber(a: string | null | undefined, b: string | null | undefined): boolean {
    const norm = (v: string | null | undefined) =>
        String(v ?? "")
            .trim()
            .toLowerCase()
            .replaceAll(/[^\da-z]/gu, "");
    return norm(a) === norm(b);
}

function resolveAddress(params: {
    input: PrepareDraftToolInput;
    currentDraft: OrderDraft | null;
    slots: InboundSlots;
    conflicts: SlotConflictCode[];
}): PrepareDraftToolInput {
    const { input, currentDraft, slots } = params;
    if (hasFlowAddressChoice(input)) return input;

    const line = slots.addressLine;
    if (!line || !slots.address) return input;

    const modelAddress = hasStructuredAddress(input) ? input.address : null;
    const modelRaw = trimmed(input.addressRaw);

    if (modelAddress) {
        /** Modelo estruturou o mesmo endereço (melhor: pode ter cidade/CEP) — mantém. */
        if (sameHouseNumber(modelAddress.numero, slots.address.numero)) return input;
        params.conflicts.push("address");
        return { ...input, address: null, addressRaw: line };
    }

    if (modelRaw) {
        const parsedSameNumber = modelRaw.includes(slots.address.numero);
        if (parsedSameNumber) return input;
        params.conflicts.push("address");
        return { ...input, addressRaw: line };
    }

    /**
     * Ninguém passou endereço: o do texto deste turno entra. Cobre o caminho
     * server-side (batch multi-item), onde não há tool call para carregar o slot.
     * Endereço do rascunho só perde se o cliente digitou outro número agora.
     */
    const draftNumero = currentDraft?.address?.numero ?? null;
    const draftLogradouro = trimmed(currentDraft?.address?.logradouro);
    if (draftLogradouro && sameHouseNumber(draftNumero, slots.address.numero)) return input;

    return { ...input, addressRaw: line };
}

function isCashMethod(value: unknown): boolean {
    const v = String(value ?? "").toLowerCase();
    return v === "cash" || v.includes("dinheiro") || v === "especie";
}

function resolvePayment(params: {
    input: PrepareDraftToolInput;
    currentDraft: OrderDraft | null;
    slots: InboundSlots;
    conflicts: SlotConflictCode[];
}): PrepareDraftToolInput {
    const { input, currentDraft, slots } = params;
    const draftPay = currentDraft?.paymentMethod ?? null;
    const draftChange = currentDraft?.changeFor ?? null;
    const allowedPay = slots.paymentMethod || draftPay;

    let paymentMethod = input.paymentMethod ?? null;
    let changeFor = input.changeFor ?? null;

    if (!allowedPay) {
        if (paymentMethod) params.conflicts.push("payment");
        paymentMethod = null;
        changeFor = null;
    } else if (paymentMethod) {
        const toolNorm = String(paymentMethod).toLowerCase();
        const allowNorm = String(allowedPay).toLowerCase();
        if (!toolNorm.includes(allowNorm) && !allowNorm.includes(toolNorm.split(/[^a-z]/)[0] ?? "")) {
            params.conflicts.push("payment");
            paymentMethod = allowedPay;
        }
    } else {
        paymentMethod = allowedPay;
    }

    if (!isCashMethod(paymentMethod)) {
        changeFor = null;
    } else if (slots.changeFor != null) {
        /** Cliente falou o troco neste turno — vale mesmo se a LLM não repassou. */
        changeFor = slots.changeFor;
    } else if (draftChange == null && changeFor != null) {
        params.conflicts.push("change");
        changeFor = null;
    }

    return {
        ...input,
        paymentMethod: paymentMethod ?? null,
        changeFor: changeFor ?? null,
    };
}

export function resolvePrepareInput(params: {
    input: PrepareDraftToolInput;
    currentDraft: OrderDraft | null;
    slots: InboundSlots;
}): { input: PrepareDraftToolInput; conflicts: SlotConflictCode[] } {
    const conflicts: SlotConflictCode[] = [];
    const withAddress = resolveAddress({ ...params, conflicts });
    const withPayment = resolvePayment({
        input: withAddress,
        currentDraft: params.currentDraft,
        slots: params.slots,
        conflicts,
    });
    return { input: withPayment, conflicts };
}
