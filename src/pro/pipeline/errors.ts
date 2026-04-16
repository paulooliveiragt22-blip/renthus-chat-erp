/** Código estável para falhas de I/O de sessão no pipeline PRO. */
export const PRO_PIPELINE_SESSION_LOAD_ERROR_CODE = "SESSION_LOAD_FAILED" as const;

export type ProPipelineSessionLoadErrorCode = typeof PRO_PIPELINE_SESSION_LOAD_ERROR_CODE;

/**
 * Erro lançado por `loadState` quando `SessionRepository.load` falha.
 * O erro original fica em `underlyingCause` para logs e dashboards.
 */
export class ProPipelineSessionLoadError extends Error {
    readonly code: ProPipelineSessionLoadErrorCode = PRO_PIPELINE_SESSION_LOAD_ERROR_CODE;

    /** Erro original do repositório / Supabase (evita depender de `ErrorOptions` no target atual). */
    readonly underlyingCause?: unknown;

    constructor(
        public readonly tenant: { companyId: string; threadId: string },
        options: { cause?: unknown } = {}
    ) {
        super(
            `Falha ao carregar sessão do pipeline PRO (empresa=${tenant.companyId}, thread=${tenant.threadId}).`
        );
        this.name = "ProPipelineSessionLoadError";
        this.underlyingCause = options.cause;
    }
}

export function isProPipelineSessionLoadError(err: unknown): err is ProPipelineSessionLoadError {
    return err instanceof ProPipelineSessionLoadError;
}
