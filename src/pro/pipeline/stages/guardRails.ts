import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";

export type GuardRailsStopReason = "empty_inbound" | "handover_hold";

export interface GuardRailsResult {
    stop: boolean;
    state: ProSessionState;
    outbound: OutboundMessage[];
    /** Preenchido quando `stop` é true (telemetria em `runProPipeline`). */
    stopReason?: GuardRailsStopReason;
}

export function guardRails(params: {
    state: ProSessionState;
    inboundText: string;
}): GuardRailsResult {
    const { state, inboundText } = params;
    const text = inboundText.trim();

    if (!text) return { stop: true, state, outbound: [], stopReason: "empty_inbound" };
    if (state.step === "handover") {
        return { stop: true, state, outbound: [], stopReason: "handover_hold" };
    }

    return { stop: false, state, outbound: [] };
}

