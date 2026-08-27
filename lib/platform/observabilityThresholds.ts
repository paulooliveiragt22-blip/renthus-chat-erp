/** Thresholds únicos — UI observabilidade, alertas P2.4 e cron. */

function envNum(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const OBS_QUEUE_FAILURE_RATE_CRITICAL = envNum(
    "PLATFORM_OBS_QUEUE_FAILURE_RATE_CRITICAL",
    0.05
);
export const OBS_QUEUE_FAILURE_RATE_WARNING = envNum(
    "PLATFORM_OBS_QUEUE_FAILURE_RATE_WARNING",
    0.02
);

export const OBS_QUEUE_PENDING_CRITICAL = envNum(
    "PLATFORM_OBS_QUEUE_PENDING_CRITICAL",
    1000
);
export const OBS_QUEUE_PENDING_WARNING = envNum(
    "PLATFORM_OBS_QUEUE_PENDING_WARNING",
    200
);

export const OBS_QUEUE_AGE_SEC_CRITICAL = envNum(
    "PLATFORM_OBS_QUEUE_AGE_SEC_CRITICAL",
    180
);
export const OBS_QUEUE_AGE_SEC_WARNING = envNum(
    "PLATFORM_OBS_QUEUE_AGE_SEC_WARNING",
    60
);

/** Semáforo por empresa (fila inbound). */
export const OBS_QUEUE_COMPANY_FAILURE_RED = envNum(
    "PLATFORM_OBS_QUEUE_COMPANY_FAILURE_RED",
    0.03
);
export const OBS_QUEUE_COMPANY_PENDING_RED = envNum(
    "PLATFORM_OBS_QUEUE_COMPANY_PENDING_RED",
    20
);

/** Alertas P2.4 — reutilizam env existentes com fallback alinhado. */
export function getPlatformAlertThresholds() {
    return {
        queuePendingN: envNum("PLATFORM_ALERT_QUEUE_PENDING_N", 50),
        queueAgeSec: envNum("PLATFORM_ALERT_QUEUE_AGE_SEC", 600),
        failureRate: envNum("PLATFORM_ALERT_FAILURE_RATE", 0.05),
        failureMinCount: envNum("PLATFORM_ALERT_FAILURE_MIN_COUNT", 3),
    };
}

export type QueueSummaryLike = {
    failureRate: number;
    pendingNow: number;
    processingNow?: number;
    backlogTotal?: number;
    failedWindow: number;
    oldestPendingAgeSec?: number;
};

export type QueueHealthLevel = "stable" | "warning" | "critical";

export function classifyQueueHealth(summary: QueueSummaryLike): QueueHealthLevel {
    const backlog = summary.backlogTotal ?? summary.pendingNow;
    const age = summary.oldestPendingAgeSec ?? 0;
    if (
        summary.failureRate > OBS_QUEUE_FAILURE_RATE_CRITICAL ||
        backlog > OBS_QUEUE_PENDING_CRITICAL ||
        age > OBS_QUEUE_AGE_SEC_CRITICAL
    ) {
        return "critical";
    }
    if (
        summary.failureRate > OBS_QUEUE_FAILURE_RATE_WARNING ||
        backlog > OBS_QUEUE_PENDING_WARNING ||
        age > OBS_QUEUE_AGE_SEC_WARNING
    ) {
        return "warning";
    }
    return "stable";
}

export function queueCompanySeverity(
    failureRate: number,
    pendingNow: number,
    processingNow: number
): "green" | "yellow" | "red" {
    const backlog = pendingNow + processingNow;
    if (
        failureRate > OBS_QUEUE_COMPANY_FAILURE_RED ||
        backlog >= OBS_QUEUE_COMPANY_PENDING_RED
    ) {
        return "red";
    }
    if (failureRate > 0 || backlog > 0) return "yellow";
    return "green";
}

/** Dedup unificado: coalesced / (done + coalesced). */
export function computeDedupHitRate(coalesced: number, done: number): number {
    const denom = done + coalesced;
    if (denom <= 0) return 0;
    return coalesced / denom;
}

export function isProPipelineIngestEnabled(): boolean {
    const v = process.env.PRO_PIPELINE_METRICS_STORE?.trim().toLowerCase() ?? "";
    return v === "supabase";
}

export function isPipelineTurnTraceEnabled(): boolean {
    const v = process.env.PRO_PIPELINE_TURN_TRACE?.trim().toLowerCase() ?? "";
    return v === "1" || v === "true" || v === "yes" || v === "on";
}
