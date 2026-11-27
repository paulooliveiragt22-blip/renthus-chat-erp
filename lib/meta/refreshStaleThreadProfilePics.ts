import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMetaChannelUserProfileResult } from "@/lib/meta/fetchMetaUserProfile";
import {
    loadActiveMetaChannelByCompany,
    resolvePageAccessToken,
} from "@/lib/meta/messagingChannels";
import {
    selectThreadsForProfilePicRefresh,
    type ProfilePicThreadRow,
} from "@/lib/meta/profilePic";

type ThreadRow = ProfilePicThreadRow & Record<string, unknown>;

/**
 * Na abertura do inbox (não no poll de 5s), lê a foto de quem ainda não tem
 * ou cuja URL passou de 12h. Falha de Graph não grava data: a próxima abertura tenta de novo.
 */
export async function hydrateInboxProfilePics<T extends ThreadRow>(
    admin: SupabaseClient,
    companyId: string,
    threads: T[],
    nowMs: number = Date.now()
): Promise<T[]> {
    const due = selectThreadsForProfilePicRefresh(threads, nowMs);
    if (due.length === 0) return threads;

    const channel = await loadActiveMetaChannelByCompany(admin, companyId);
    const accessToken = channel ? resolvePageAccessToken(channel) : "";
    if (!channel || !accessToken) return threads;

    const updates = new Map<string, string | null>();
    await Promise.allSettled(
        due.map(async (thread) => {
            const externalId = thread.external_id?.trim() ?? "";
            const metaChannel = thread.channel === "messenger" ? "messenger" : "instagram";
            const result = await fetchMetaChannelUserProfileResult({
                channel: metaChannel,
                userId: externalId,
                pageId: channel.page_id,
                accessToken,
            });
            if (!result.ok) return;

            const pic = result.profile?.profilePicUrl ?? null;
            const patch: { profile_pic_fetched_at: string; profile_pic_url?: string } = {
                profile_pic_fetched_at: new Date(nowMs).toISOString(),
            };
            if (pic) patch.profile_pic_url = pic;

            const { error } = await admin
                .from("whatsapp_threads")
                .update(patch)
                .eq("id", thread.id)
                .eq("company_id", companyId);
            if (error) {
                console.warn("[meta/profile] persist_failed", { threadId: thread.id, error: error.message });
                return;
            }
            updates.set(thread.id, pic ?? thread.profile_pic_url ?? null);
        })
    );

    if (updates.size === 0) return threads;
    return threads.map((thread) => {
        if (!updates.has(thread.id)) return thread;
        return { ...thread, profile_pic_url: updates.get(thread.id) ?? null };
    });
}
