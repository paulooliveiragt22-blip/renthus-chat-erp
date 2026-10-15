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
import { extractCandidatePendingTermsFromUserText, textHasProductBesidesFulfillment } from "@/src/pro/domain/orderWorklist/extractCandidateTerms";
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
    /\b(?:vou\s+(?:buscar|retirar|pegar)|passo\s+(?:ai|para\s+(?:buscar|pegar))|retirar|retirada|retiro|busco|eu\s+pego|sem\s+entrega|nao\s+(?:precisa|preciso|quero)\s+entregar|nao\s+quero\s+entrega)\b/u;
const DELIVERY_RE = /\b(?:entrega|entregar|entregue|delivery|pra\s+entrega|quero\s+receber)\b/u;
/**
 * Destino de entrega. "manda 2 skol" e "me manda uma coca" ficam de fora:
 * aí "manda" é verbo de pedido, não modalidade.
 */
const DELIVERY_SEND_RE =
    /\b(?:pode\s+)?(?:manda|mande|mandar|envia|envie|enviar|traz|traga|trazer)\s+(?:pra|para)\s+(?:mim|ca|casa|aqui)\b/u;
const DELIVERY_ME_VERB_RE =
    /\bme\s+(?:manda|mande|envia|envie|traz|traga)\b(?!\s+(?:um|uma|uns|umas|\d+|o|a|os|as)\b)/u;
const DELIVERY_PLACE_RE =
    /\b(?:na\s+minha\s+casa|no\s+meu\s+endereco|deixa(?:r)?\s+na\s+porta)\b/u;
/** "Manda duas Heineken pra mim" — o produto fica entre o verbo e o destino. */
const DELIVERY_DEST_TAIL_RE = /\b(?:pra|para)\s+(?:mim|casa|ca|aqui)\b/u;

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
    if (
        DELIVERY_RE.test(t) ||
        DELIVERY_SEND_RE.test(t) ||
        DELIVERY_ME_VERB_RE.test(t) ||
        DELIVERY_PLACE_RE.test(t) ||
        DELIVERY_DEST_TAIL_RE.test(t)
    ) {
        return "delivery";
    }
    return null;
}

/**
 * Modalidade dita antes do rascunho existir (lista UN/CX). Fica na sessão até
 * o draft receber item; menção deste turno vence; draft já preenchido zera.
 */
export function nextPendingFulfillment(params: {
    mentioned: FulfillmentType | null;
    remembered: FulfillmentType | null | undefined;
    draftFulfillment: FulfillmentType | null | undefined;
}): FulfillmentType | null {
    if (params.mentioned === "delivery" || params.mentioned === "pickup") return params.mentioned;
    if (params.draftFulfillment === "delivery" || params.draftFulfillment === "pickup") return null;
    if (params.remembered === "delivery" || params.remembered === "pickup") return params.remembered;
    return null;
}

/** Regex deste turno vence. O extract só preenche quando a regex não casou. */
export function resolveTurnFulfillment(params: {
    regex: FulfillmentType | null;
    extracted: FulfillmentType | null;
}): FulfillmentType | null {
    if (params.regex === "delivery" || params.regex === "pickup") return params.regex;
    if (params.extracted === "delivery" || params.extracted === "pickup") return params.extracted;
    return null;
}

/**
 * O que gravar quando a regex não casou. Não troca uma modalidade que o rascunho já tem.
 */
export function fulfillmentToApplyWhenRegexMisses(params: {
    regex: FulfillmentType | null;
    extracted: FulfillmentType | null;
    draftFulfillment: FulfillmentType | null | undefined;
}): FulfillmentType | null {
    if (params.regex === "delivery" || params.regex === "pickup") return null;
    if (params.draftFulfillment === "delivery" || params.draftFulfillment === "pickup") return null;
    return resolveTurnFulfillment({ regex: null, extracted: params.extracted });
}
export function isFulfillmentOnlyInbound(slots: InboundSlots, userText = ""): boolean {
    if (
        slots.fulfillmentType == null ||
        slots.orderLines.length > 0 ||
        slots.address != null ||
        slots.addressLine != null ||
        slots.paymentMethod != null ||
        slots.changeFor != null
    ) {
        return false;
    }
    if (userText && textHasProductBesidesFulfillment(userText)) return false;
    return true;
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
