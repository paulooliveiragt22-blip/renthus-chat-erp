export type BotRestoreReason =
    | "confirmation_resolved_confirmed"
    | "confirmation_resolved_cancelled"
    | "confirmation_resolved_expired"
    | "confirmation_resolved_failed_order";

export interface ThreadBotStatePort {
    restoreBotAfterHandover(params: {
        companyId: string;
        threadId: string;
        reason: BotRestoreReason;
        restoredAtIso: string;
    }): Promise<void>;
}
