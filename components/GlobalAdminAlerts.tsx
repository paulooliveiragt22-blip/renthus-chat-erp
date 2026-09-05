"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { unlockOrderAlertAudio } from "@/lib/utils/playBeep";
import { createHttpOrderAlertFeed } from "@/lib/admin-alerts/adapters/httpOrderAlertFeed";
import { createHttpHandoverAlertFeed } from "@/lib/admin-alerts/adapters/httpHandoverAlertFeed";
import { createBrowserOsNotificationPort } from "@/lib/admin-alerts/adapters/browserOsNotification";
import {
    createDedupeState,
    pollAndDiffFeeds,
    presentNewAlerts,
} from "@/lib/admin-alerts/application/presentNewAlerts";
import { ensureAdminPushSubscription } from "@/lib/admin-alerts/application/ensureAdminPushSubscription";

const POLL_MS = 5_000;

/**
 * Alertas globais: pedido novo + handover humano.
 * Toast clicável (bottom-right) + Notification OS (desktop/mobile/tablet) quando
 * a aba/app está em background — ou sempre em viewport estreito (mobile).
 */
export function GlobalAdminAlerts() {
    const { currentCompanyId: companyId, loading } = useWorkspace();
    const router = useRouter();
    const dedupeRef = useRef(createDedupeState());
    const osRef = useRef(createBrowserOsNotificationPort());

    useEffect(() => {
        const unlock = () => {
            unlockOrderAlertAudio();
            void osRef.current.ensurePermission();
            void ensureAdminPushSubscription();
        };
        window.addEventListener("pointerdown", unlock, { passive: true });
        window.addEventListener("keydown", unlock);
        return () => {
            window.removeEventListener("pointerdown", unlock);
            window.removeEventListener("keydown", unlock);
        };
    }, []);

    // Navegação vinda do clique na notificação do SW
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        const onMsg = (ev: MessageEvent) => {
            const data = ev.data as { type?: string; href?: string } | null;
            if (data?.type === "ADMIN_ALERT_NAV" && data.href) {
                router.push(data.href);
            }
        };
        navigator.serviceWorker.addEventListener("message", onMsg);
        return () => navigator.serviceWorker.removeEventListener("message", onMsg);
    }, [router]);

    useEffect(() => {
        if (loading || !companyId) return;

        dedupeRef.current = createDedupeState();
        let cancelled = false;

        const feeds = [createHttpOrderAlertFeed(), createHttpHandoverAlertFeed()];

        const navigate = (href: string) => {
            router.push(href);
        };

        async function poll() {
            if (cancelled) return;
            try {
                const newcomers = await pollAndDiffFeeds(feeds, dedupeRef.current);
                if (cancelled || newcomers.length === 0) return;

                const isNarrow =
                    typeof window !== "undefined" &&
                    window.matchMedia("(max-width: 768px)").matches;

                presentNewAlerts(newcomers, {
                    navigate,
                    os: osRef.current,
                    // Mobile/tablet: OS mesmo com app aberto; desktop: só se aba em background
                    preferOsAlways: isNarrow,
                });
            } catch {
                /* ignore transient */
            }
        }

        void poll();
        const timer = window.setInterval(() => void poll(), POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [companyId, loading, router]);

    return null;
}

/** @deprecated use GlobalAdminAlerts */
export { GlobalAdminAlerts as GlobalOrderNotifier };
