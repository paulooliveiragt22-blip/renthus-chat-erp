import * as Sentry from "@sentry/nextjs";

/**
 * `SENTRY_DSN` vazio (padrão até configurar o projeto no Sentry) desliga o
 * envio de eventos sem erro — `Sentry.init` com `dsn: undefined` é um no-op
 * seguro no SDK. Ver docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 2.
 */
Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    enabled: Boolean(process.env.SENTRY_DSN),
});
