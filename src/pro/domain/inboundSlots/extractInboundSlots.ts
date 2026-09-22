/**
 * Envelope de slots do inbound (ADR 0012) — interpretação canônica do que o cliente
 * disse neste turno, calculada **1× por turno** por função pura (sem I/O, sem LLM).
 *
 * Existe porque `prepare_order_draft` é chamado de oito lugares, cada um com uma visão
 * parcial do turno: o batch multi-item mandava `address: null` fixo e derrubava endereço
 * e forma de pagamento de mensagens completas ("manda 2 caixas de X aqui na rua Y 850,
 * bairro Z. pagamento no pix").
 */

import type { FulfillmentType, InboundSlots, PaymentMethod } from "@/src/types/contracts";
import { hashUserTextForSeal } from "@/src/pro/domain/orderWorklist/orderWorklist";
import { extractCandidatePendingTermsFromUserText } from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
import {
    extractAddressLineFromText,
    tryParseAddressOneLine,
} from "@/src/pro/tools/parseAddressLoosePt";
import {
    parsePaymentMethodFromUserText,
    parsePtMoneyInput,
} from "@/src/pro/pipeline/paymentFromUserText";

export const EMPTY_INBOUND_SLOTS: InboundSlots = Object.freeze({
    addressLine: null,
    address: null,
    paymentMethod: null,
    changeFor: null,
    fulfillmentType: null,
    orderLines: [],
    sourceTextHash: hashUserTextForSeal(""),
}) as InboundSlots;

const PICKUP_RE =
    /\b(?:vou\s+(?:buscar|retirar|pegar)|passo\s+(?:a[ií]|para\s+(?:buscar|pegar))|retirar|retirada|retiro|busco)\b/u;
const DELIVERY_RE = /\b(?:entrega|entregar|entregue|delivery)\b/u;

/** "troco pra 100", "troco de R$ 50" — exige a palavra troco (não inventa valor). */
const CHANGE_FOR_RE = /\btroco\s*(?:pra|para|de|em)?\s*(?:r?\$)?\s*([\d.,]+)/u;

function normalize(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/gu, " ");
}

/** Modalidade citada em texto livre. Retirada vence ("não quero entrega, vou buscar"). */
export function detectFulfillmentMentionFromText(text: string): FulfillmentType | null {
    const t = normalize(text);
    if (!t) return null;
    if (PICKUP_RE.test(t)) return "pickup";
    if (DELIVERY_RE.test(t)) return "delivery";
    return null;
}

/**
 * Valor de troco no texto. Aceita a mensagem que é só o valor (turno de
 * `pro_awaiting_change_amount`) ou a forma explícita "troco pra X" dentro de uma frase.
 */
export function parseChangeForFromText(text: string): number | null {
    const direct = parsePtMoneyInput(text);
    if (direct != null) return direct;

    const m = CHANGE_FOR_RE.exec(normalize(text));
    if (!m?.[1]) return null;
    const value = Number(m[1].replaceAll(".", "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

export function extractInboundSlots(userText: string): InboundSlots {
    const raw = String(userText ?? "");
    const sourceTextHash = hashUserTextForSeal(raw);
    if (!raw.trim()) return { ...EMPTY_INBOUND_SLOTS, sourceTextHash };

    const addressLine = extractAddressLineFromText(raw);
    const address = addressLine ? tryParseAddressOneLine(addressLine) : null;
    const paymentMethod: PaymentMethod | null = parsePaymentMethodFromUserText(raw);
    const changeFor = parseChangeForFromText(raw);

    return {
        addressLine,
        address,
        paymentMethod,
        /** Troco só faz sentido com dinheiro; pagamento ainda pode vir do draft. */
        changeFor: paymentMethod === "pix" || paymentMethod === "card" ? null : changeFor,
        fulfillmentType: detectFulfillmentMentionFromText(raw),
        orderLines: extractCandidatePendingTermsFromUserText(raw).map((t) => ({
            rawTerm: t.rawTerm,
            quantity: t.quantity ?? null,
        })),
        sourceTextHash,
    };
}
