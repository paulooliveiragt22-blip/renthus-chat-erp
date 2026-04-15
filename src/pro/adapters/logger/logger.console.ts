import type { LoggerPort } from "../../ports/logger.port";

export class ConsoleLoggerAdapter implements LoggerPort {
    info(message: string, data?: Record<string, unknown>): void {
        console.info(`[pro-v2] ${message}`, data ?? {});
    }

    warn(message: string, data?: Record<string, unknown>): void {
        console.warn(`[pro-v2] ${message}`, data ?? {});
    }

    error(message: string, data?: Record<string, unknown>): void {
        console.error(`[pro-v2] ${message}`, data ?? {});
    }
}

