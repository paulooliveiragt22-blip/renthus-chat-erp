"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Último boundary de erro do App Router — substitui o `<html>` inteiro.
 * Reporta ao Sentry (no-op se `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` vazios).
 * Ver docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 2.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        Sentry.captureException(error);
    }, [error]);

    return (
        <html lang="pt-BR">
            <body>
                <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 p-6 text-center">
                    <h1 className="text-lg font-semibold text-neutral-900">
                        Algo deu errado
                    </h1>
                    <p className="max-w-md text-sm text-neutral-600">
                        Ocorreu um erro inesperado. Nossa equipe já foi notificada.
                        Tente novamente em alguns instantes.
                    </p>
                    <button
                        onClick={() => reset()}
                        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                    >
                        Tentar novamente
                    </button>
                </div>
            </body>
        </html>
    );
}
