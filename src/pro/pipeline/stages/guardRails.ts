import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";

export interface GuardRailsResult {
    stop: boolean;
    state: ProSessionState;
    outbound: OutboundMessage[];
}

export function guardRails(params: {
    state: ProSessionState;
    inboundText: string;
}): GuardRailsResult {
    const { state, inboundText } = params;
    const text = inboundText.trim();

    if (!text) return { stop: true, state, outbound: [] };
    if (state.step === "handover") return { stop: true, state, outbound: [] };

    return { stop: false, state, outbound: [] };
}

