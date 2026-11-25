const HUMAN_RE = /\b(?:atendente|humano|suporte|falar\s+com)\b/iu;

export function asksForHuman(text: string): boolean {
    return HUMAN_RE.test(text.trim());
}
