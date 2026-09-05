import type { OsNotificationPort } from "../ports/AlertPorts";

/**
 * Notification API do sistema (Windows/macOS/Android; iOS/iPad via PWA instalada).
 * Aparece na bandeja/lock screen do SO — fora do app Renthus — quando o browser permite.
 *
 * Limite: com o app **totalmente fechado**, iOS exige Web Push (VAPID + SW).
 * Enquanto a sessão/PWA estiver viva em 2º plano, esta API cobre desktop + mobile + tablet.
 */
export function createBrowserOsNotificationPort(): OsNotificationPort {
    return {
        async ensurePermission() {
            if (typeof window === "undefined" || typeof Notification === "undefined") {
                return "unsupported";
            }
            if (Notification.permission === "granted") return "granted";
            if (Notification.permission === "denied") return "denied";
            try {
                return await Notification.requestPermission();
            } catch {
                return "denied";
            }
        },

        show(alert, opts) {
            if (typeof window === "undefined" || typeof Notification === "undefined") return;
            if (Notification.permission !== "granted") return;

            try {
                const n = new Notification(alert.title, {
                    body: alert.description,
                    tag: alert.id,
                    data: { href: alert.href },
                    // Chrome/Edge: reapresenta toast do SO com a mesma `tag`
                    ...({ renotify: true } as NotificationOptions),
                });
                n.onclick = () => {
                    try {
                        window.focus();
                    } catch {
                        /* ignore */
                    }
                    opts.onClick();
                    n.close();
                };
            } catch {
                /* Safari / políticas restritas */
            }
        },
    };
}

export function shouldShowOsNotification(): boolean {
    if (typeof document === "undefined") return false;
    return document.visibilityState === "hidden" || !document.hasFocus();
}
