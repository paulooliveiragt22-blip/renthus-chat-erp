import {
    createOfflineCommand,
    type NewOfflineCommandInput,
    type OfflineCommand,
} from "../domain/OfflineCommand";
import {
    canEnqueueCommand,
    getDefaultSyncEligibilityLimits,
    type SyncEligibilityLimits,
} from "../domain/SyncEligibility";
import type { OutboxStore } from "../ports/OutboxStore";
import { notifySyncStatusChanged } from "../syncStatusStore";

export type EnqueueCommandResult =
    | { ok: true; command: OfflineCommand }
    | {
          ok: false;
          reason: "type_not_allowed" | "queue_full" | "command_too_old" | "invalid_company";
      };

export async function enqueueCommand(
    store: OutboxStore,
    input: NewOfflineCommandInput,
    limits: SyncEligibilityLimits = getDefaultSyncEligibilityLimits()
): Promise<EnqueueCommandResult> {
    const command = createOfflineCommand(input);
    const pendingCount = await store.countPending(command.companyId);
    const eligibility = canEnqueueCommand(command, pendingCount, limits);
    if (!eligibility.ok) {
        return { ok: false, reason: eligibility.reason };
    }
    await store.enqueue(command);
    notifySyncStatusChanged();
    return { ok: true, command };
}
