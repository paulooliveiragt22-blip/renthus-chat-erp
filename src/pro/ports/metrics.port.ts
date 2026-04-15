export interface MetricsPort {
    increment(name: string, value?: number, tags?: Record<string, string>): void;
    timing(name: string, valueMs: number, tags?: Record<string, string>): void;
}

