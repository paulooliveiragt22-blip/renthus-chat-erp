/**
 * Extrai mensagem útil do erro Graph e só sugere App Review em falhas de auth/permissão.
 * Antes, qualquer falha no submit ganhava o hint de whatsapp_business_management —
 * escondendo causas reais (nome duplicado, componente inválido, categoria, etc.).
 */

export type MetaGraphErrorBody = {
    message?: string;
    error_user_msg?: string;
    error_user_title?: string;
    code?: number;
    error_subcode?: number;
    type?: string;
};

/** Códigos Meta típicos de token/oauth/permissão. */
const PERM_CODES = new Set([10, 190, 200]);

export function parseMetaGraphError(
    json: Record<string, unknown> | undefined,
    status: number
): { error: string; hint?: string; code?: number } {
    const err = json?.error as MetaGraphErrorBody | undefined;
    const code = typeof err?.code === "number" ? err.code : undefined;
    const message =
        err?.error_user_msg?.trim() ||
        err?.message?.trim() ||
        `graph_http_${status}`;

    const looksLikePerm =
        (code != null && PERM_CODES.has(code)) ||
        /permission|oauth|access token|whatsapp_business_management|(#10\b)|(#190\b)|(#200\b)/i.test(
            message
        );

    return {
        error: message,
        code,
        hint: looksLikePerm
            ? "Permissão whatsapp_business_management / App Review pode estar pendente."
            : undefined,
    };
}

/** Mensagem de UI: erro Meta primeiro; hint só se existir e for distinto. */
export function formatMetaClientError(
    error?: string | null,
    hint?: string | null,
    fallback = "Falha na Meta."
): string {
    const e = error?.trim();
    const h = hint?.trim();
    if (e && h && h !== e) return `${e} — ${h}`;
    return e || h || fallback;
}
