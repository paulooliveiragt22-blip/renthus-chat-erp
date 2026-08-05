/** Extrai texto plano da resposta `LlmPort` (blocos Anthropic-like ou string). */

export function extractLlmPlainText(content: unknown): string {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: string; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
        } else if (typeof b.text === "string" && !b.type) {
            parts.push(b.text);
        }
    }
    return parts.join("\n").trim();
}

export function hasLlmApiKey(provider?: string): boolean {
    const p = (provider ?? process.env.LLM_PROVIDER ?? "anthropic").trim().toLowerCase() || "anthropic";
    if (p === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
