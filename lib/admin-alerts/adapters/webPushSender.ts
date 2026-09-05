/**
 * Envio Web Push para admins da empresa (app fechado / PWA).
 * Env: NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (+ opcional VAPID_SUBJECT mailto:)
 */

import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminAlert } from "../domain/AdminAlert";

export type PushSubscriptionRow = {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
};

function configureVapid(): boolean {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    if (!publicKey || !privateKey) return false;
    const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:ops@renthus.com.br";
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return true;
}

export function getVapidPublicKey(): string | null {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
}

export async function dispatchCompanyPush(
    admin: SupabaseClient,
    companyId: string,
    alert: Pick<AdminAlert, "title" | "description" | "href" | "id">
): Promise<{ sent: number; removed: number }> {
    if (!configureVapid()) return { sent: 0, removed: 0 };

    const { data, error } = await admin
        .from("admin_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("company_id", companyId);

    if (error || !data?.length) return { sent: 0, removed: 0 };

    const payload = JSON.stringify({
        title: alert.title,
        body: alert.description,
        href: alert.href,
        tag: alert.id,
    });

    let sent = 0;
    let removed = 0;

    const results = await Promise.allSettled(
        data.map(async (row) => {
            try {
                await webpush.sendNotification(
                    {
                        endpoint: row.endpoint,
                        keys: { p256dh: row.p256dh, auth: row.auth },
                    },
                    payload,
                    { TTL: 60 * 60 }
                );
                return { ok: true as const, id: row.id };
            } catch (e: unknown) {
                const status =
                    e && typeof e === "object" && "statusCode" in e
                        ? Number((e as { statusCode: number }).statusCode)
                        : 0;
                // 404/410 = subscription morta
                if (status === 404 || status === 410) {
                    await admin.from("admin_push_subscriptions").delete().eq("id", row.id);
                    return { ok: false as const, gone: true };
                }
                return { ok: false as const, gone: false };
            }
        })
    );

    for (const r of results) {
        if (r.status !== "fulfilled") continue;
        if (r.value.ok) sent += 1;
        else if (r.value.gone) removed += 1;
    }

    return { sent, removed };
}
