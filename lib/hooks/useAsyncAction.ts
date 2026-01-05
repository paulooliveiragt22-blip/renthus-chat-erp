import { useCallback, useRef, useState } from "react";

type ErrorLike = { code?: string; message?: string; status?: number } | Error | null;

export type ActionError = {
    message: string;
    retryable?: boolean;
};

export type ActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: ActionError | null };

function isSupabaseAuthError(error: unknown): error is { code?: string; message: string; status?: number } {
    return (
        typeof error === "object" &&
        error !== null &&
        "message" in error &&
        typeof (error as Record<string, unknown>).message === "string"
    );
}

export function mapSupabaseAuthError(error: ErrorLike): ActionError {
    if (!error) {
        return {
            message: "Ocorreu um erro inesperado. Tente novamente.",
            retryable: true,
        };
    }

    const code = (error as { code?: string }).code;
    const status = (error as { status?: number }).status;
    const message = (error as { message?: string }).message ?? "";

    switch (code) {
        case "invalid_email":
        case "email_format":
            return { message: "Informe um e-mail válido." };
        case "invalid_credentials":
        case "auth_invalid_credentials":
        case "invalid_grant":
            return { message: "E-mail ou senha inválidos." };
        case "email_not_confirmed":
        case "email_confirmed_required":
            return { message: "Confirme seu e-mail para continuar." };
        case "over_email_send_rate_limit":
            return { message: "Muitos pedidos. Tente novamente em instantes.", retryable: true };
        default:
            break;
    }

    if (status && status >= 500) {
        return {
            message: "Estamos com instabilidade. Tente novamente em alguns segundos.",
            retryable: true,
        };
    }

    if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("network")) {
        return { message: "Não foi possível conectar. Tente novamente.", retryable: true };
    }

    if (isSupabaseAuthError(error)) {
        return { message: error.message || "Ocorreu um erro inesperado.", retryable: status ? status >= 500 : false };
    }

    return { message: "Ocorreu um erro inesperado. Tente novamente.", retryable: true };
}

export function useAsyncAction<Args extends unknown[], Result>(
    action: (...args: Args) => Promise<Result>
) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ActionError | null>(null);
    const [result, setResult] = useState<Result | null>(null);
    const lastArgs = useRef<Args | null>(null);

    const execute = useCallback(
        async (...args: Args): Promise<ActionResult<Result>> => {
            setLoading(true);
            setError(null);
            lastArgs.current = args;

            try {
                const data = await action(...args);
                setResult(data);
                return { ok: true, data };
            } catch (err) {
                const mapped = mapSupabaseAuthError(err as ErrorLike);
                setError(mapped);
                return { ok: false, error: mapped };
            } finally {
                setLoading(false);
            }
        },
        [action]
    );

    const retry = useCallback(() => {
        if (!lastArgs.current) return Promise.resolve<ActionResult<Result>>({ ok: false, error: null });
        return execute(...lastArgs.current);
    }, [execute]);

    const reset = useCallback(() => {
        setError(null);
        setResult(null);
    }, []);

    return {
        execute,
        retry,
        reset,
        loading,
        error,
        result,
    };
}
