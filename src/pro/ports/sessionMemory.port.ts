import type { AiTurn } from "@/src/types/contracts";

export type CompactHistoryInput = {
    history: AiTurn[];
    existingSummary?: string | null;
    /** Turns a manter intactos no fim. */
    keepRecentTurns?: number;
    /** Dispara compactação se history.length > este valor. */
    triggerMinTurns?: number;
};

export type CompactHistoryResult = {
    history: AiTurn[];
    summary: string | null;
    compacted: boolean;
};

/**
 * Compacta histórico longo (rolling summary) para caber na janela do LLM.
 */
export interface SessionMemoryPort {
    compactIfNeeded(input: CompactHistoryInput): Promise<CompactHistoryResult>;
}
