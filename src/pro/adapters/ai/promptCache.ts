/**
 * Anthropic prompt caching — helpers puros (ADR-0003 §9.3).
 *
 * Hierarquia Anthropic: `tools` → `system` → `messages`.
 * Breakpoint na **última tool** só cacheia tools (sem system) → Haiku 4.5
 * (≥4096) ignora em silêncio. Breakpoint no **system** cacheia tools+system
 * (prefixo estável entre turnos). Draft/worklist/hints ficam no user.
 */
import type { LlmProviderName } from "@/src/pro/adapters/ai/modelProvider";
import type { EnvLike } from "@/lib/env/EnvLike";

export const ANTHROPIC_PROMPT_CACHE_CONTROL = {
    type: "ephemeral" as const,
    ttl: "5m" as const,
};

/** Mínimo cacheável Haiku 4.5 (docs Anthropic). */
export const ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS = 4096;

/**
 * Estimativa conservadora (baixa) do bloco `tools` do agente PRO.
 * Subestimar → pad a mais no system → garante passar do mínimo.
 */
export const ESTIMATED_AGENT_TOOLS_TOKENS_LOW = 1800;

export function isLlmPromptCacheEnabled(
    provider: LlmProviderName,
    env: EnvLike = process.env
): boolean {
    const raw = env.LLM_CACHE_CONTROL_ENABLED?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
    if (provider !== "anthropic") return false;
    // default on for Anthropic; explicit 1/true also on
    if (raw === undefined || raw === "") return true;
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function anthropicCacheProviderOptions(): {
    anthropic: { cacheControl: typeof ANTHROPIC_PROMPT_CACHE_CONTROL };
} {
    return { anthropic: { cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL } };
}

/** Estimativa baixa de tokens (chars/4) — preferir pad a mais do que ficar sob o mínimo. */
export function estimateAnthropicTokensLow(text: string): number {
    const n = String(text ?? "").length;
    if (n <= 0) return 0;
    return Math.ceil(n / 4);
}

/**
 * Few-shots estáveis (não mudam por turno) para fechar o mínimo de cache Haiku 4.5
 * sem encher de lixo — reforçam regras já canônicas do system.
 */
const CACHE_FLOOR_FEW_SHOTS = `
--- Exemplos estáveis (cache; não invente fora das tools) ---
Ex1: Cliente: "quero 2 skol e 1 original". Servidor: worklist pending_search. Ação: search_produtos por cada termo; prepare_order_draft só com UUID do JSON; respond_to_customer curto.
Ex2: Cliente: "a caixa". Há pending pick UN/CX. Ação: resolve_pending_picks / prepare com o UUID da CX; não reliste opções se o servidor já mandou botões.
Ex3: Cliente: "pix". Draft com itens+endereço. Ação: prepare_order_draft payment_method=pix; não invente troco; respond_to_customer sem dizer pedido criado.
Ex4: Cliente: "quanto custa a heineken lata?". Ação: search_produtos; cite só preco_venda/display_name do JSON; sem estoque numérico.
Ex5: Cliente: "trocar a skol por brahma". Ação: search brahma; prepare aditivo/substituição com UUID permitido; não zere o carrinho.
Ex6: Saudação sem itens. Ação: respond_to_customer breve; servidor manda botões de cardápio/atendente — não cole URL.
Ex7: search vazio / did_you_mean. Ação: use o JSON; peça esclarecimento; não invente produto.
Ex8: Cliente manda qty sem produto novo ("3"). Ação: trate como pick/qty do pending; não re-semeie worklist.
Ex9: Dois tamanhos ("marmitas m" e "marmitas g"). Ação: duas lines distintas; não colapse M/G.
Ex10: "lata"/"longneck" sem "caixa". Ação: prefira UN na busca quando o catálogo tiver; não force CX por hábito.
--- Fim exemplos estáveis ---
`.trim();

/**
 * Garante tools+system ≥ mínimo Haiku. Pad é estável (mesmo texto sempre) → cache hit.
 */
export function ensureStableSystemMeetsCacheFloor(
    stableSystem: string,
    opts?: {
        minTotalTokens?: number;
        estimatedToolsTokens?: number;
    }
): string {
    const minTotal = opts?.minTotalTokens ?? ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS;
    const toolsEst = opts?.estimatedToolsTokens ?? ESTIMATED_AGENT_TOOLS_TOKENS_LOW;
    const base = String(stableSystem ?? "");
    const needInSystem = Math.max(0, minTotal - toolsEst);
    if (estimateAnthropicTokensLow(base) >= needInSystem) return base;

    let out = base.endsWith("\n") ? `${base}\n${CACHE_FLOOR_FEW_SHOTS}` : `${base}\n\n${CACHE_FLOOR_FEW_SHOTS}`;
    // Se ainda faltar (modelo futuro com mínimo maior), repete o bloco de forma determinística.
    let guard = 0;
    while (estimateAnthropicTokensLow(out) < needInSystem && guard < 8) {
        out += `\n\n(cache-floor ${guard + 1})\n${CACHE_FLOOR_FEW_SHOTS}`;
        guard += 1;
    }
    return out;
}
