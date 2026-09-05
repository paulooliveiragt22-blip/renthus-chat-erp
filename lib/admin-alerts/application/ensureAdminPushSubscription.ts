"use client";

/**
 * Subscribe Web Push (desktop + Android + iOS PWA 16.4+).
 * Requer NEXT_PUBLIC_VAPID_PUBLIC_KEY no build + SW com push-sw.js.
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

export async function ensureAdminPushSubscription(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (!window.isSecureContext) return false;

    try {
        if (Notification.permission === "denied") return false;
        if (Notification.permission !== "granted") {
            const p = await Notification.requestPermission();
            if (p !== "granted") return false;
        }

        const keyRes = await fetch("/api/admin/push/vapid-public-key", {
            credentials: "include",
            cache: "no-store",
        });
        if (!keyRes.ok) return false;
        const { publicKey } = (await keyRes.json()) as { publicKey?: string };
        if (!publicKey) return false;

        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
            });
        }

        const json = sub.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

        const save = await fetch("/api/admin/push/subscribe", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                endpoint: json.endpoint,
                keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
                userAgent: navigator.userAgent,
            }),
        });
        return save.ok;
    } catch {
        return false;
    }
}
