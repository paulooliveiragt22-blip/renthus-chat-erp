/**
 * Política de fase do checkout PRO: textos canônicos e scrub de confirmação precoce.
 */
import type { OutboundMessage, ProStep } from "@/src/types/contracts";

export type CheckoutPhase =
    | "collect_items"
    | "confirm_address"
    | "register_address"
    | "collect_payment"
    | "confirm_order"
    | "idle";

export function phaseFromProStep(step: ProStep | string | null | undefined): CheckoutPhase {
    switch (step) {
        case "pro_awaiting_address_confirmation":
            return "confirm_address";
        case "pro_awaiting_cart_review":
            return "confirm_order";
        case "pro_awaiting_payment_method":
        case "pro_awaiting_change_amount":
            return "collect_payment";
        case "pro_awaiting_confirmation":
            return "confirm_order";
        case "pro_collecting_order":
            return "collect_items";
        default:
            return "idle";
    }
}

/** Playbook curto injetado no system prompt (especialista delivery). */
export function buildPhasePlaybookForModel(params: {
    step: ProStep | string | null | undefined;
    deliveryAddressUiConfirmed?: boolean;
    hasDraftItems?: boolean;
    hasPayment?: boolean;
    addressComplete?: boolean;
}): string {
    const phase = phaseFromProStep(params.step);
    const lines = [
        "--- Fase atual do checkout (servidor; obedeça) ---",
        `fase=${phase}`,
        `step=${params.step ?? "pro_idle"}`,
        `endereco_ui_confirmado=${params.deliveryAddressUiConfirmed === true}`,
        `tem_itens=${Boolean(params.hasDraftItems)}`,
        `endereco_completo=${Boolean(params.addressComplete)}`,
        `tem_pagamento=${Boolean(params.hasPayment)}`,
    ];

    if (phase === "confirm_address") {
        lines.push(
            "Fase rara (legado). Se endereço já tem rua/número/bairro/cidade/UF, NÃO peça confirmar endereço — o servidor avança."
        );
    } else if (phase === "collect_payment") {
        lines.push(
            "Resumo já confirmado. Oriente só o pagamento (PIX/cartão/dinheiro). Não invente totais nem diga que o pedido foi criado."
        );
    } else if (phase === "confirm_order") {
        lines.push(
            "O servidor envia o resumo oficial com taxa e botões Confirmar/Corrigir. Não peça forma de pagamento ainda — só depois do Confirmar. Não invente totais nem peça 'sim' em texto paralelo."
        );
    } else if (phase === "collect_items") {
        lines.push(
            "Foque em entender o pedido. Se houver várias opções, NÃO liste preços — o servidor envia botões; peça número ou toque no botão."
        );
        if (params.hasDraftItems) {
            lines.push(
                "Já há itens no rascunho: em troca/edição, busque pelo NOME do produto (ex.: salgadinho caixa), não só embalagem; não apague outros itens."
            );
            lines.push(
                "Com itens no rascunho e sem pagamento: NÃO peça endereço nem pagamento na prosa — o servidor envia Entrega/Retirar (se ambos ligados), depois o resumo, depois pagamento. No máximo 1 frase curta listando o que anotou."
            );
        }
    }

    lines.push("--- Fim fase ---");
    return lines.join("\n");
}

function normalizePt(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

/** Detecta texto de IA pedindo confirmação final do pedido (conflita com CTA de endereço). */
export function looksLikeFinalOrderConfirmAsk(text: string): boolean {
    const flat = normalizePt(text);
    const hints = [
        "confirme o pedido",
        "confirmar o pedido",
        "confirma o pedido",
        "pode confirmar o pedido",
        "pedido pronto",
        "pedido montado",
        "revise os dados e confirme",
        "digite sim",
        "responda sim",
        "me confirme com um sim",
        "posso confirmar",
        "fechamos o pedido",
        "finalizar o pedido",
        "confirme para eu finalizar",
    ];
    return hints.some((h) => flat.includes(h));
}

/**
 * Em hold de endereço: remove prosa de “confirme o pedido” e mantém só CTAs/fases.
 * Se sobrar só lixo, injeta texto curto canônico.
 */
export function scrubOutboundForAddressHold(
    outbound: OutboundMessage[],
    opts?: { canonicalText?: string }
): OutboundMessage[] {
    const kept: OutboundMessage[] = [];
    for (const m of outbound) {
        if (m.kind !== "text") {
            kept.push(m);
            continue;
        }
        const t = String(m.text ?? "").trim();
        if (!t) continue;
        if (looksLikeFinalOrderConfirmAsk(t)) continue;
        kept.push(m);
    }
    const hasInteractive = kept.some((m) => m.kind === "buttons" || m.kind === "cta_url");
    const hasText = kept.some((m) => m.kind === "text");
    if (hasInteractive && !hasText) {
        kept.unshift({
            kind: "text",
            text:
                opts?.canonicalText ??
                "Quase la! Confirme o endereco de entrega nos botoes abaixo para continuar o pedido.",
        });
    }
    return kept;
}

/** IA ainda “busca produto” / lista opções / pede pagamento — polui botões do servidor. */
export function looksLikeCheckoutUiPollution(text: string): boolean {
    const flat = normalizePt(text);
    if (!flat) return false;
    const hints = [
        "qual voce prefere",
        "qual voce quer",
        "tem mais duas opcoes",
        "tem mais opcoes",
        "mais duas opcoes",
        "vou buscar",
        "enquanto isso",
        "forma de pagamento",
        "escolhe a forma",
        "escolha a forma",
        "agora escolhe",
        "agora escolha",
        "pix, cartao",
        "pix, cartão",
        "cartao ou dinheiro",
        "encontrei mais de uma",
        "temos a ",
    ];
    if (hints.some((h) => flat.includes(h))) return true;
    if (/\br\$\b/.test(flat) && (flat.includes("opcao") || flat.includes("opcoes"))) return true;
    return false;
}

/** Detecta prosa da IA pedindo endereço antes da escolha Entrega/Retirada. */
export function looksLikePrematureAddressAsk(text: string): boolean {
    const flat = normalizePt(text);
    const hints = [
        "preciso do seu endereco",
        "preciso do endereco",
        "me passa o endereco",
        "me envie o endereco",
        "qual o endereco",
        "qual seu endereco",
        "endereco de entrega",
        "rua, numero",
        "rua numero bairro",
        "cadastrar o endereco",
        "onde entregar",
        "para onde entregamos",
        "para onde entregar",
    ];
    return hints.some((h) => flat.includes(h));
}

/**
 * Com itens no draft e modalidade ainda em aberto: o servidor manda Entrega/Retirar.
 * Qualquer prosa da IA (opções extras, “vou buscar”, pedido de pagamento/endereço)
 * polui o turno — descarta texto e deixa só botões/CTA.
 */
export function scrubOutboundForFulfillmentChoice(outbound: OutboundMessage[]): OutboundMessage[] {
    return outbound.filter((m) => m.kind !== "text");
}

/**
 * Quando o servidor já vai mandar PIX/Cartão/Dinheiro: tira pedido de pagamento
 * e lista de produto na prosa da IA.
 */
export function scrubOutboundForServerPaymentUi(outbound: OutboundMessage[]): OutboundMessage[] {
    return outbound.filter((m) => {
        if (m.kind !== "text") return true;
        const t = String(m.text ?? "").trim();
        if (!t) return false;
        if (looksLikeCheckoutUiPollution(t) || looksLikePrematureAddressAsk(t)) return false;
        return true;
    });
}

export function buildDeliverySpecialistSystemPreamble(): string {
    return `Você é especialista em atendimento de delivery pelo WhatsApp (planos PRO/Market).
- Tom: cordial, objetivo, PT-BR do Brasil; frases curtas; sem jargão técnico.
- Contexto: o cliente pode digitar errado (hamburgueres→hambúrguer). Use search_produtos; se vier did_you_mean, ofereça essas opções em uma frase curta (sem dump de preço).
- Nunca invente produto, preço, estoque, taxa ou ETA — só tools.
- Upsell leve só se fizer sentido (ex.: caixa quando pediu unidade), sem pressão.
- Checkout é faseado pelo servidor: modalidade (Entrega/Retirada) → endereço se entrega → resumo (Confirmar) → pagamento → fecha o pedido. Respeite o bloco "Fase atual".
- Quando search_produtos tiver várias embalagens: NÃO liste preços/opções na prosa — o servidor envia a pergunta/botões de escolha.`;
}

/** Regras duras exportadas p/ testes A (C3.1) — espelho das proibições do SYSTEM_PROMPT. */
export const SYSTEM_HARD_RULES_PT = [
    "use somente produto_embalagem_id do JSON items do último search_produtos",
    "Nunca diga que o pedido já foi criado",
    "Não afirme \"pedido confirmado\"",
    "não assuma quantity=1",
    "SEMPRE termine chamando a tool respond_to_customer",
    "NÃO liste preços/opções no texto",
] as const;
