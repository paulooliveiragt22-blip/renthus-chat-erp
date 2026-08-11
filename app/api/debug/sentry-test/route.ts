/**
 * GET /api/debug/sentry-test
 *
 * Rota temporária só pra validar que o DSN configurado está realmente
 * entregando eventos no dashboard da Sentry. Protegida pela auth de sessão
 * padrão do `proxy.ts` (não está na allowlist — exige login).
 *
 * REMOVER após confirmar o evento em Issues no painel da Sentry.
 * Ver docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md item 2.
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const eventId = Sentry.captureException(
        new Error("[sentry-test] evento de teste — pode ignorar/resolver na Sentry")
    );

    // Serverless: a função pode terminar antes do SDK enviar o evento por HTTP.
    await Sentry.flush(2000);

    return NextResponse.json({
        ok: true,
        eventId,
        sentryEnabled: Boolean(process.env.SENTRY_DSN),
        message: "Evento de teste disparado. Confira em Issues no painel da Sentry.",
    });
}
