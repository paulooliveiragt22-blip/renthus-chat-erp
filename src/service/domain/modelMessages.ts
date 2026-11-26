import { wrapUserInboundForLlm } from "@/src/pro/adapters/ai/userInboundGuard";
import type { SiteChatPriorTurn } from "@/src/service/domain/siteChat";

export type ServiceModelMessage = {
    role: "user" | "assistant";
    content: string;
};

const HISTORY_LIMIT = 12;

export function toServiceModelMessages(
    prior: readonly SiteChatPriorTurn[] | undefined,
    currentText: string,
    channelLabel: string
): ServiceModelMessage[] {
    const history = (prior ?? []).slice(-HISTORY_LIMIT).map((turn) => ({
        role: turn.role,
        content:
            turn.role === "user"
                ? wrapUserInboundForLlm(turn.text, channelLabel)
                : turn.text.replace(/\s+/gu, " ").trim().slice(0, 1000),
    }));
    const messages: ServiceModelMessage[] = [
        ...history,
        { role: "user", content: wrapUserInboundForLlm(currentText, channelLabel) },
    ];
    const merged: ServiceModelMessage[] = [];
    for (const message of messages) {
        if (message.content.length === 0) continue;
        const last = merged[merged.length - 1];
        if (last && last.role === message.role) {
            last.content = `${last.content}\n${message.content}`.slice(0, 4000);
            continue;
        }
        merged.push({ role: message.role, content: message.content });
    }
    while (merged[0]?.role === "assistant") merged.shift();
    return merged;
}
