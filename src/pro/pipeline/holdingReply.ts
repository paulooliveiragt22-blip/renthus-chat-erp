import type { OutboundMessage } from "@/src/types/contracts";

const HOLDING_RE =
    /\b(?:um momento|ja ja|vou procurar|deixa eu ver|deixa eu buscar|so um instante|um instante)\b/u;

export const HOLDING_REPLY_FALLBACK_PT = "Qual produto você quer?";

function normalize(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/gu, " ");
}

/** Promessa de busca. Com preço, só conta quando o carrinho não ganhou item. */
export function isHoldingPromiseText(text: string, opts?: { allowPrice?: boolean }): boolean {
    const n = normalize(text);
    if (!n) return false;
    if (!opts?.allowPrice && /\br\$\s*\d/u.test(n)) return false;
    return HOLDING_RE.test(n);
}

/**
 * Se o turno não buscou nem adicionou item, uma frase de espera não pode
 * ser a única mensagem ao cliente.
 */
export function replaceHoldingOnlyReply(
    messages: readonly OutboundMessage[],
    opts?: { allowPrice?: boolean }
): OutboundMessage[] {
    if (messages.length === 0) return [...messages];
    if (messages.some((m) => m.kind !== "text")) return [...messages];
    if (!messages.every((m) => m.kind === "text" && isHoldingPromiseText(m.text ?? "", opts))) {
        return [...messages];
    }
    return [{ kind: "text", text: HOLDING_REPLY_FALLBACK_PT }];
}
