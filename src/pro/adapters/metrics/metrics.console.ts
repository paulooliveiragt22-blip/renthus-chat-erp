import type { MetricsPort } from "../../ports/metrics.port";

export class ConsoleMetricsAdapter implements MetricsPort {
    private readonly endpoint = process.env.METRICS_INGEST_URL?.trim() ?? "";
    private readonly token = process.env.METRICS_INGEST_TOKEN?.trim() ?? "";

    private emit(event: {
        type: "increment" | "timing";
        name: string;
        value: number;
        tags?: Record<string, string>;
    }): void {
        if (!this.endpoint) return;
        void fetch(this.endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            },
            body: JSON.stringify({
                ...event,
                ts: Date.now(),
                source: "pro-pipeline-v2",
            }),
        }).catch((error) => {
            console.warn("[metrics.emit.failed]", {
                name: event.name,
                reason: error instanceof Error ? error.message : String(error),
            });
        });
    }

    increment(name: string, value = 1, tags?: Record<string, string>): void {
        console.info("[metrics.increment]", { name, value, tags });
        this.emit({ type: "increment", name, value, tags });
    }

    timing(name: string, valueMs: number, tags?: Record<string, string>): void {
        console.info("[metrics.timing]", { name, valueMs, tags });
        this.emit({ type: "timing", name, value: valueMs, tags });
    }
}

