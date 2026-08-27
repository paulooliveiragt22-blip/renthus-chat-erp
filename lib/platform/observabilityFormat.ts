import {
    classifyQueueHealth,
    type QueueHealthLevel,
    type QueueSummaryLike,
} from "@/lib/platform/observabilityThresholds";

export function formatPeriodLabel(minutes: number): string {
    if (minutes === 15) return "15m";
    if (minutes === 60) return "1h";
    if (minutes === 1440) return "24h";
    return `${minutes}m`;
}

export function formatPct(v: number): string {
    return `${(v * 100).toFixed(1)}%`;
}

export function formatAgeSec(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return "0s";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function formatLastUpdated(ts: number): string {
    if (!ts) return "—";
    return new Date(ts).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function semaphoreLabel(severity: string): string {
    if (severity === "red") return "Crítico";
    if (severity === "yellow") return "Atenção";
    return "Saudável";
}

export function semaphoreStyle(severity: string): string {
    if (severity === "red") {
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    }
    if (severity === "yellow") {
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    }
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
}

export function queueAlertBoxStyle(level: QueueHealthLevel): string {
    if (level === "critical") {
        return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400";
    }
    if (level === "warning") {
        return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400";
    }
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-400";
}

export function queueAlertBoxMessage(
    summary: QueueSummaryLike,
    period: string
): string {
    const level = classifyQueueHealth(summary);
    const backlog = summary.backlogTotal ?? summary.pendingNow;
    const age = summary.oldestPendingAgeSec ?? 0;
    const proc = summary.processingNow ?? 0;

    if (level === "critical") {
        if (summary.failureRate > 0.05) {
            return `Crítico: failure rate acima do limite na janela ${period}. Investigue imediatamente.`;
        }
        return `Crítico: backlog alto (pending=${summary.pendingNow}, processing=${proc}, total=${backlog}, idade máx=${formatAgeSec(age)}).`;
    }
    if (level === "warning") {
        return `Atenção: fila degradada (failed=${summary.failedWindow}, pending=${summary.pendingNow}, processing=${proc}, idade=${formatAgeSec(age)}).`;
    }
    return "Saúde estável: sem alertas ativos pelos thresholds unificados.";
}
