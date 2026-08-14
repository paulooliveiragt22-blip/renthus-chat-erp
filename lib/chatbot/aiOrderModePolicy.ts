/**
 * Política de modo da IA + cota de turnos (híbrido: idle sessão / wall-clock cota).
 *
 * - close_orders (default): IA fecha pedido; sem limite de mensagens.
 * - info_only: não fecha pedido; opcionalmente limita turnos Anthropic.
 */

import type { OutboundMessage } from "@/src/types/contracts";

export type AiOrderMode = "close_orders" | "info_only";

export type AiOrderModePolicy = {
    mode: AiOrderMode;
    sessionIdleMinutes: number;
    aiSessionWindowMinutes: number;
    /** 0 = ilimitado; só aplica em info_only */
    aiMaxTurnsPerSession: number;
};

export type AiTurnQuotaState = {
    aiTurnCount?: number;
    aiWindowStartedAt?: string | null;
};

const DEFAULT_IDLE = 120;
const DEFAULT_WINDOW = 60;

function clampInt(n: unknown, fallback: number, min: number, max: number): number {
    const v = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(v)));
}

export function parseAiOrderModePolicy(
    config: Record<string, unknown> | null | undefined
): AiOrderModePolicy {
    const cfg = config ?? {};
    const rawMode = String(cfg.ai_order_mode ?? "close_orders").trim().toLowerCase();
    const mode: AiOrderMode = rawMode === "info_only" ? "info_only" : "close_orders";
    return {
        mode,
        sessionIdleMinutes: clampInt(cfg.session_idle_minutes, DEFAULT_IDLE, 15, 24 * 60),
        aiSessionWindowMinutes: clampInt(cfg.ai_session_window_minutes, DEFAULT_WINDOW, 5, 24 * 60),
        aiMaxTurnsPerSession: clampInt(cfg.ai_max_turns_per_session, 0, 0, 500),
    };
}

export function isInfoOnlyMode(policy: AiOrderModePolicy): boolean {
    return policy.mode === "info_only";
}

/** Limite de turnos só existe em info_only com max > 0. */
export function hasAiTurnLimit(policy: AiOrderModePolicy): boolean {
    return policy.mode === "info_only" && policy.aiMaxTurnsPerSession > 0;
}

export function resolveAiTurnWindow(
    state: AiTurnQuotaState,
    policy: AiOrderModePolicy,
    nowMs: number
): { count: number; windowStartedAt: string; reset: boolean } {
    const windowMs = policy.aiSessionWindowMinutes * 60_000;
    const startedRaw = state.aiWindowStartedAt;
    const startedMs = startedRaw ? Date.parse(String(startedRaw)) : NaN;
    if (!Number.isFinite(startedMs) || nowMs - startedMs >= windowMs) {
        return {
            count: 0,
            windowStartedAt: new Date(nowMs).toISOString(),
            reset: true,
        };
    }
    return {
        count: Math.max(0, Number(state.aiTurnCount ?? 0) || 0),
        windowStartedAt: new Date(startedMs).toISOString(),
        reset: false,
    };
}

export function isAiTurnLimitExceeded(
    state: AiTurnQuotaState,
    policy: AiOrderModePolicy,
    nowMs: number
): boolean {
    if (!hasAiTurnLimit(policy)) return false;
    const w = resolveAiTurnWindow(state, policy, nowMs);
    return w.count >= policy.aiMaxTurnsPerSession;
}

/** Incrementa após um turno Anthropic cobrado (só se há limite). */
export function bumpAiTurnCount<T extends AiTurnQuotaState>(
    state: T,
    policy: AiOrderModePolicy,
    nowMs: number
): T {
    if (!hasAiTurnLimit(policy)) return state;
    const w = resolveAiTurnWindow(state, policy, nowMs);
    return {
        ...state,
        aiTurnCount: w.count + 1,
        aiWindowStartedAt: w.windowStartedAt,
    };
}

export function buildAiLimitExceededOutbound(opts: {
    webMenuUrl?: string | null;
}): OutboundMessage[] {
    const web = String(opts.webMenuUrl ?? "").trim();
    const lines = [
        "Você atingiu o limite de mensagens com a IA nesta conversa.",
        "Pode continuar pelo *cardápio web*, falar com um *atendente* ou usar o *menu automático*.",
    ];
    if (web) lines.push(`Cardápio: ${web}`);

    const buttons: Array<{ id: string; title: string }> = [
        { id: "human", title: "Falar com atendente" },
    ];
    if (web) buttons.unshift({ id: "catalog", title: "Cardápio web" });

    return [
        { kind: "text", text: lines.join("\n") },
        { kind: "buttons", text: "Como prefere seguir?", buttons: buttons.slice(0, 3) },
    ];
}

export function buildInfoOnlyOrderBlockedText(webMenuUrl?: string | null): string {
    const web = String(webMenuUrl ?? "").trim();
    if (web) {
        return (
            "Neste modo a IA só tira dúvidas — o pedido é pelo *cardápio web*.\n" +
            `Acesse: ${web}`
        );
    }
    return (
        "Neste modo a IA só tira dúvidas e não fecha pedido pelo WhatsApp. " +
        "Use o cardápio/menu da loja ou fale com um atendente."
    );
}
