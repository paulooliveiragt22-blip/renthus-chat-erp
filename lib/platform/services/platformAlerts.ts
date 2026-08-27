import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getQueueHealthStats } from "@/lib/platform/services/platformOps";

export type PlatformAlertSeverity = "critical" | "warning" | "info";

export type PlatformAlert = {
    id: string;
    severity: PlatformAlertSeverity;
    title: string;
    detail: string;
    /** Machine-readable code for silence/filters */
    code:
        | "queue_backlog_sustained"
        | "queue_failure_spike"
        | "suspended_company_active_channel"
        | "suspended_company_recent_queue"
        | "sentry_wa_webhook_hint";
    metadata?: Record<string, unknown>;
};

function envInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Avalia regras P2.4 (dashboard + cron). Sem persistência — snapshot pontual.
 *
 * - Fila: pending > N e oldest pending ≥ 10 min
 * - Empresa suspensa com canal WA ainda active
 * - Empresa suspensa com jobs na fila na última hora
 * - Hint ops: alertar 5xx do webhook no Sentry (não duplica métrica in-app)
 */
export async function evaluatePlatformAlerts(
    admin: SupabaseClient
): Promise<{
    ok: boolean;
    generatedAt: string;
    alerts: PlatformAlert[];
    thresholds: {
        queuePendingN: number;
        queueAgeSec: number;
        failureRate: number;
    };
}> {
    const queuePendingN = envInt("PLATFORM_ALERT_QUEUE_PENDING_N", 50);
    const queueAgeSec = envInt("PLATFORM_ALERT_QUEUE_AGE_SEC", 600);
    const failureRateThreshold = Number(process.env.PLATFORM_ALERT_FAILURE_RATE ?? "0.05");

    const alerts: PlatformAlert[] = [];

    let queue: Awaited<ReturnType<typeof getQueueHealthStats>> | null = null;
    try {
        queue = await getQueueHealthStats(admin, 15);
    } catch (e) {
        alerts.push({
            id: "queue_stats_error",
            severity: "warning",
            code: "queue_failure_spike",
            title: "Não foi possível ler a fila chatbot",
            detail: e instanceof Error ? e.message : "erro desconhecido",
        });
    }

    if (queue) {
        const { pendingNow, oldestPendingAgeSec, failureRate, failed15m } = queue.summary;
        if (pendingNow > queuePendingN && oldestPendingAgeSec >= queueAgeSec) {
            alerts.push({
                id: "queue_backlog_sustained",
                severity: "critical",
                code: "queue_backlog_sustained",
                title: "Fila chatbot acumulada há ≥10 min",
                detail: `${pendingNow} pending (limite ${queuePendingN}); item mais antigo há ${Math.round(oldestPendingAgeSec / 60)} min.`,
                metadata: { pendingNow, oldestPendingAgeSec, queuePendingN, queueAgeSec },
            });
        }
        if (failureRate >= failureRateThreshold && failed15m >= 3) {
            alerts.push({
                id: "queue_failure_spike",
                severity: "warning",
                code: "queue_failure_spike",
                title: "Taxa de falha da fila elevada (15m)",
                detail: `${failed15m} falhas; failureRate ${(failureRate * 100).toFixed(1)}% (limite ${(failureRateThreshold * 100).toFixed(0)}%).`,
                metadata: { failed15m, failureRate },
            });
        }
    }

    const { data: suspendedActiveChannels, error: chErr } = await admin
        .from("whatsapp_channels")
        .select("id, company_id, from_identifier, companies!inner(id, name, is_active)")
        .eq("status", "active")
        .eq("companies.is_active", false);

    if (chErr) {
        alerts.push({
            id: "suspended_channel_query_error",
            severity: "warning",
            code: "suspended_company_active_channel",
            title: "Falha ao checar canais de empresas suspensas",
            detail: chErr.message,
        });
    } else if ((suspendedActiveChannels?.length ?? 0) > 0) {
        const names = [
            ...new Set(
                (suspendedActiveChannels ?? []).map((row) => {
                    const co = row.companies as
                        | { name?: string }
                        | { name?: string }[]
                        | null;
                    const name = Array.isArray(co) ? co[0]?.name : co?.name;
                    return name ?? row.company_id;
                })
            ),
        ];
        alerts.push({
            id: "suspended_company_active_channel",
            severity: "critical",
            code: "suspended_company_active_channel",
            title: "Empresa suspensa com canal WhatsApp ainda ativo",
            detail: `${suspendedActiveChannels!.length} canal(is): ${names.slice(0, 5).join(", ")}${names.length > 5 ? "…" : ""}`,
            metadata: {
                channelIds: suspendedActiveChannels!.map((r) => r.id),
                companyIds: [...new Set(suspendedActiveChannels!.map((r) => r.company_id))],
            },
        });
    }

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data: recentQueue, error: qErr } = await admin
        .from("chatbot_queue")
        .select("company_id, companies!inner(id, name, is_active)")
        .eq("companies.is_active", false)
        .gte("created_at", since)
        .limit(100);

    if (qErr) {
        alerts.push({
            id: "suspended_queue_query_error",
            severity: "warning",
            code: "suspended_company_recent_queue",
            title: "Falha ao checar fila de empresas suspensas",
            detail: qErr.message,
        });
    } else if ((recentQueue?.length ?? 0) > 0) {
        const byCompany = new Map<string, string>();
        for (const row of recentQueue ?? []) {
            const co = row.companies as { name?: string } | { name?: string }[] | null;
            const name = Array.isArray(co) ? co[0]?.name : co?.name;
            byCompany.set(row.company_id, name ?? row.company_id);
        }
        alerts.push({
            id: "suspended_company_recent_queue",
            severity: "critical",
            code: "suspended_company_recent_queue",
            title: "Empresa suspensa ainda gerando jobs na fila (60m)",
            detail: `${recentQueue!.length} job(s) em ${byCompany.size} empresa(s): ${[...byCompany.values()].slice(0, 5).join(", ")}`,
            metadata: {
                jobCount: recentQueue!.length,
                companyIds: [...byCompany.keys()],
            },
        });
    }

    alerts.push({
        id: "sentry_wa_webhook_hint",
        severity: "info",
        code: "sentry_wa_webhook_hint",
        title: "Webhook WhatsApp 5xx — monitore no Sentry",
        detail:
            "Configure alerta Sentry na rota /api/whatsapp/incoming (taxa de erro / 5xx). O app evita 5xx no happy-path; picos costumam ser misconfig ou throws não tratados.",
    });

    const actionable = alerts.filter((a) => a.severity !== "info");
    return {
        ok: actionable.length === 0,
        generatedAt: new Date().toISOString(),
        alerts,
        thresholds: {
            queuePendingN,
            queueAgeSec,
            failureRate: failureRateThreshold,
        },
    };
}
