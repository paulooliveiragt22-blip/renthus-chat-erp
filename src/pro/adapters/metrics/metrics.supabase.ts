import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetricsPort } from "../../ports/metrics.port";
import { ConsoleMetricsAdapter } from "./metrics.console";

function splitTenantTags(tags?: Record<string, string>): {
    companyId: string | null;
    threadId: string | null;
    rest: Record<string, string>;
} {
    if (!tags) return { companyId: null, threadId: null, rest: {} };
    const { companyId, threadId, ...rest } = tags;
    const cid = typeof companyId === "string" && companyId.trim() ? companyId.trim() : null;
    const tid = typeof threadId === "string" && threadId.trim() ? threadId.trim() : null;
    return { companyId: cid, threadId: tid, rest };
}

/** Persiste métricas no Supabase (service role) e delega log / METRICS_INGEST ao {@link ConsoleMetricsAdapter}. */
export class SupabaseMetricsAdapter implements MetricsPort {
    private readonly inner: MetricsPort;

    constructor(
        private readonly admin: SupabaseClient,
        inner?: MetricsPort
    ) {
        this.inner = inner ?? new ConsoleMetricsAdapter();
    }

    increment(name: string, value = 1, tags?: Record<string, string>): void {
        this.inner.increment(name, value, tags);
        void this.persist(name, value, tags);
    }

    timing(name: string, valueMs: number, tags?: Record<string, string>): void {
        this.inner.timing(name, valueMs, tags);
        void this.persist(name, valueMs, tags);
    }

    private async persist(
        name: string,
        value: number,
        tags?: Record<string, string>
    ): Promise<void> {
        const { companyId, threadId, rest } = splitTenantTags(tags);
        if (!companyId) {
            console.warn("[metrics.supabase.skip]", { name, reason: "missing_companyId" });
            return;
        }
        const { error } = await this.admin.from("pro_pipeline_metric_events").insert({
            company_id: companyId,
            thread_id: threadId,
            metric_name: name,
            value,
            tags: rest,
        });
        if (error) {
            console.warn("[metrics.supabase.insert_failed]", {
                name,
                message: error.message,
                code: error.code,
            });
        }
    }
}
