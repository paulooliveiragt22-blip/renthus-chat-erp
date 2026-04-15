import type { MetricsPort } from "../../ports/metrics.port";

export class ConsoleMetricsAdapter implements MetricsPort {
    increment(name: string, value = 1, tags?: Record<string, string>): void {
        console.info("[metrics.increment]", { name, value, tags });
    }

    timing(name: string, valueMs: number, tags?: Record<string, string>): void {
        console.info("[metrics.timing]", { name, valueMs, tags });
    }
}

