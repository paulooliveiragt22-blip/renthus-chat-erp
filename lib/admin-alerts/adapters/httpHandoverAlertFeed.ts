import type { AdminAlert } from "../domain/AdminAlert";
import { channelLabel } from "../domain/AdminAlert";
import { threadOpenHref } from "../domain/AlertDeepLink";
import type { AlertFeed } from "../ports/AlertPorts";

type HandoverRow = {
    threadId: string;
    handoverAt: string;
    channel: string | null;
    profileName: string | null;
    phoneE164: string | null;
    reason: string | null;
};

export function mapHandoverRowsToAlerts(rows: HandoverRow[]): AdminAlert[] {
    return rows.map((r) => {
        const who = (r.profileName ?? r.phoneE164 ?? "Cliente").trim() || "Cliente";
        const ch = channelLabel(r.channel);
        const reason = (r.reason ?? "Solicitou atendimento humano").trim();
        return {
            id: `handover:${r.threadId}:${r.handoverAt}`,
            kind: "chat_handover",
            title: `Atendimento humano · ${ch}`,
            description: `${who} — ${reason}`,
            href: threadOpenHref(r.threadId),
            createdAt: r.handoverAt,
            actionLabel: "Abrir conversa",
        };
    });
}

export function createHttpHandoverAlertFeed(): AlertFeed {
    return {
        async fetchAlerts() {
            const res = await fetch("/api/admin/chat/handover-notify-snapshot", {
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return [];
            const json = (await res.json().catch(() => ({}))) as {
                handovers?: HandoverRow[];
            };
            return mapHandoverRowsToAlerts(json.handovers ?? []);
        },
    };
}
