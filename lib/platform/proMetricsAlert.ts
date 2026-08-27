import { formatPeriodLabel } from "@/lib/platform/observabilityFormat";

const PRO_METRICS_HARD_FAILURES_THRESHOLD = parseEnvInt(
    process.env.NEXT_PUBLIC_PRO_METRICS_ALERT_HARD_FAILURES_THRESHOLD,
    3
);
const PRO_METRICS_AMBIGUOUS_THRESHOLD = parseEnvInt(
    process.env.NEXT_PUBLIC_PRO_METRICS_ALERT_AMBIGUOUS_THRESHOLD,
    2
);

export type ProMetricsAlertResult = { style: string; message: string };

export function buildProMetricsAlert(
    proMetrics:
        | {
              volume: number;
              ingestEnabled?: boolean;
              distinctRuns?: number;
              rows: Array<{ metricName: string; reason: string | null; total: number }>;
          }
        | undefined,
    isLoading: boolean,
    periodMinutes: number
): ProMetricsAlertResult {
    if (isLoading) {
        return {
            style: "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-300",
            message: "Carregando métricas do pipeline PRO...",
        };
    }

    const period = formatPeriodLabel(periodMinutes);

    if (proMetrics?.ingestEnabled === false) {
        return {
            style: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400",
            message: `Ingest PRO desligado: defina PRO_PIPELINE_METRICS_STORE=supabase no worker. Painel vazio não significa bot parado.`,
        };
    }

    const volume = proMetrics?.volume ?? 0;
    if (!volume) {
        return {
            style: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400",
            message: `Atenção: sem eventos pro_pipeline.* na janela ${period}. Verifique tráfego e ingest no worker.`,
        };
    }

    const rows = proMetrics?.rows ?? [];
    const sumBy = (predicate: (row: { metricName: string; reason: string | null; total: number }) => boolean) =>
        rows.reduce((acc, row) => (predicate(row) ? acc + row.total : acc), 0);

    const hardFailures = sumBy((row) =>
        row.metricName === "pro_pipeline.order_failed"
        || row.metricName === "pro_pipeline.ai_provider_error"
        || row.metricName === "pro_pipeline.ai_rate_limited"
    );
    if (hardFailures >= PRO_METRICS_HARD_FAILURES_THRESHOLD) {
        return {
            style: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-400",
            message: `Crítico: ${hardFailures} falhas duras do pipeline PRO em ${period} (order_failed / ai_provider_error / ai_rate_limited).`,
        };
    }

    const ambiguous = sumBy((row) => row.reason === "confirmation_ambiguous");
    if (ambiguous >= PRO_METRICS_AMBIGUOUS_THRESHOLD) {
        return {
            style: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400",
            message: `Atenção: ${ambiguous} ocorrências de confirmation_ambiguous em ${period}. Revisar prompts e UX de confirmação.`,
        };
    }

    const runs = proMetrics?.distinctRuns ?? 0;
    return {
        style: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-400",
        message: `Saúde estável: ${volume} eventos (${runs} runs pro_pipeline.run) na janela ${period}.`,
    };
}

function parseEnvInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}
