import { NextResponse } from "next/server";

/**
 * Contrato único de erro pra rotas de API server-side (Route Handlers).
 * Ver docs/API_ERROR_CONTRACT.md pro contrato completo e o plano de migração
 * das rotas que ainda não usam este formato.
 */
export interface ApiError {
    /** Código estável em snake_case, seguro pra `switch`/lógica no client. Nunca muda entre releases. */
    code: string;
    /** Mensagem legível pra exibir na UI. Nunca é `err.message` cru de driver/Postgres. */
    message: string;
}

export interface ApiErrorBody {
    error: ApiError;
    [extra: string]: unknown;
}

/**
 * Resposta de erro no formato `{ error: { code, message } }`.
 * `extra` permite anexar campos adicionais (ex.: `confirmationId`) sem quebrar o contrato base.
 */
export function jsonError(
    code: string,
    message: string,
    status: number,
    extra?: Record<string, unknown>
): NextResponse<ApiErrorBody> {
    return NextResponse.json({ error: { code, message }, ...extra }, { status });
}

/** Deriva um `code` estável a partir do HTTP status, pra erros que hoje só têm status (sem code próprio). */
export function codeFromStatus(status: number): string {
    switch (status) {
        case 400: return "bad_request";
        case 401: return "unauthorized";
        case 403: return "forbidden";
        case 404: return "not_found";
        case 409: return "conflict";
        case 422: return "unprocessable";
        case 429: return "rate_limited";
        case 502: return "upstream_error";
        case 503: return "unavailable";
        default: return status >= 500 ? "internal_error" : "bad_request";
    }
}

/** Tipo do retorno de falha de `requireCompanyAccess` (`{ ok: false, status, error }`). */
interface AccessDenied {
    ok: false;
    status: number;
    error: string;
}

/**
 * Converte o retorno de falha de `requireCompanyAccess`/`requireSuperAdminAccess` (`{ok:false,
 * status, error}`, `error` como string curta tipo "Unauthorized") pro envelope padrão, sem precisar
 * alterar a assinatura desses helpers (usados em dezenas de rotas fora do piloto desta migração).
 */
export function jsonAccessError(ctx: AccessDenied): NextResponse<ApiErrorBody> {
    return jsonError(codeFromStatus(ctx.status), ctx.error, ctx.status);
}

/**
 * Erro inesperado (exceção não tratada, erro de driver/Postgres) — loga o detalhe real
 * server-side (+ Sentry) e devolve mensagem genérica pro client. Nunca repassa `err.message`
 * cru, que pode conter nome de tabela/coluna, constraint, ou detalhe de query.
 */
export async function jsonInternalError(
    err: unknown,
    context: { route: string; [k: string]: unknown }
): Promise<NextResponse<ApiErrorBody>> {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[api:${context.route}]`, detail, context);
    try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.captureException(err, {
            tags: {
                route: context.route,
                ...(typeof context.platform_actor_id === "string"
                    ? { platform_actor_id: context.platform_actor_id }
                    : {}),
                ...(typeof context.platform_role === "string"
                    ? { platform_role: context.platform_role }
                    : {}),
                ...(typeof context.request_id === "string"
                    ? { request_id: context.request_id }
                    : {}),
            },
            extra: context,
        });
    } catch {
        /* Sentry indisponível (build/edge) — log acima já registrou o erro. */
    }
    return jsonError("internal_error", "Erro interno. Tente novamente em instantes.", 500);
}
