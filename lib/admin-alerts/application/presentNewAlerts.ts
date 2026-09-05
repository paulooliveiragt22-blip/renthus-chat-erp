import type { AdminAlert } from "../domain/AdminAlert";
import type { AlertFeed, OsNotificationPort } from "../ports/AlertPorts";
import { presentClickableSonnerAlert } from "../adapters/sonnerClickablePresenter";
import { shouldShowOsNotification } from "../adapters/browserOsNotification";
import { playBeep, unlockOrderAlertAudio } from "@/lib/utils/playBeep";

export type PresentAlertsDeps = {
    navigate: (href: string) => void;
    os: OsNotificationPort;
    /** Forçar OS notify mesmo com aba em foco (mobile/tablet costuma precisar). */
    preferOsAlways?: boolean;
};

/**
 * Beep + toast clicável + Notification OS quando apropriado.
 */
export function presentNewAlerts(
    alerts: AdminAlert[],
    deps: PresentAlertsDeps
): void {
    if (alerts.length === 0) return;

    unlockOrderAlertAudio();
    playBeep();
    if (alerts.length > 1) {
        window.setTimeout(() => playBeep(), 700);
    }

    const primary = alerts[0]!;
    // Um toast por lote (evita spam); OS notifica o primeiro (tag dedupe).
    presentClickableSonnerAlert(primary, deps.navigate);

    const showOs = deps.preferOsAlways || shouldShowOsNotification();
    if (showOs) {
        deps.os.show(primary, {
            onClick: () => deps.navigate(primary.href),
        });
    } else if (alerts.length > 1) {
        // Vários itens: ainda assim OS se background
        /* no-op */
    }
}

export type DedupeState = {
    seen: Set<string>;
    ready: boolean;
};

export function createDedupeState(): DedupeState {
    return { seen: new Set(), ready: false };
}

/**
 * Diff de feed: primeiro poll só memoriza; seguintes retornam novos.
 */
export function diffAlertFeed(
    state: DedupeState,
    current: AdminAlert[],
    maxSeen = 300
): AdminAlert[] {
    const ids = new Set(current.map((a) => a.id));

    if (!state.ready) {
        state.seen = ids;
        state.ready = true;
        return [];
    }

    const newcomers = current.filter((a) => !state.seen.has(a.id));
    for (const id of ids) state.seen.add(id);
    if (state.seen.size > maxSeen) {
        state.seen = new Set(ids);
    }
    return newcomers;
}

export async function pollAndDiffFeeds(
    feeds: AlertFeed[],
    state: DedupeState
): Promise<AdminAlert[]> {
    const settled = await Promise.allSettled(feeds.map((f) => f.fetchAlerts()));
    const merged: AdminAlert[] = [];
    for (const r of settled) {
        if (r.status === "fulfilled") merged.push(...r.value);
    }
    merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return diffAlertFeed(state, merged);
}
