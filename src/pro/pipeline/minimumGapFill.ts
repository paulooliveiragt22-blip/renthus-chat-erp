import type { OutboundMessage } from "@/src/types/contracts";

export type GapFillSuggestion = {
    produtoEmbalagemId: string;
    label: string;
    price: number;
};

function brl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

/**
 * Acrescenta até 3 favoritos reais na frase de pedido mínimo.
 * Não repete item que já está no rascunho.
 */
export function appendGapFillersToMinimumMessage(
    outbound: readonly OutboundMessage[],
    suggestions: readonly GapFillSuggestion[],
    draftEmbalagemIds: readonly string[]
): OutboundMessage[] {
    const inDraft = new Set(draftEmbalagemIds.filter(Boolean));
    const lines = suggestions
        .filter(
            (s) =>
                s.label.trim() &&
                Number.isFinite(s.price) &&
                s.price > 0 &&
                !inDraft.has(s.produtoEmbalagemId)
        )
        .slice(0, 3);
    if (!lines.length) return [...outbound];

    const extra =
        "\n\nPara completar, pode ser:\n" +
        lines.map((s) => `• ${s.label.trim()} — R$ ${brl(s.price)}`).join("\n");

    let used = false;
    return outbound.map((m) => {
        if (used || m.kind !== "text") return m;
        const text = String(m.text ?? "");
        if (!/m[ií]nimo para entrega/iu.test(text) || text.includes("Para completar")) return m;
        used = true;
        return { ...m, text: `${text}${extra}` };
    });
}
