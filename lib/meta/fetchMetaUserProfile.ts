import "server-only";

import { readMetaProfilePicUrl } from "@/lib/meta/profilePic";
import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v20.0";

export type MetaChannelUserProfile = {
    displayName: string | null;
    username?: string | null;
    profilePicUrl: string | null;
};

export type MetaProfileFetchResult =
    | { ok: true; profile: MetaChannelUserProfile | null }
    | { ok: false };

function buildDisplayNameFromGraph(
    channel: "instagram" | "messenger",
    json: Record<string, unknown>
): string | null {
    if (channel === "instagram") {
        const name = typeof json.name === "string" ? json.name.trim() : "";
        const username = typeof json.username === "string" ? json.username.trim() : "";
        if (name) return name.slice(0, 120);
        if (username) {
            const handle = username.startsWith("@") ? username : `@${username}`;
            return handle.slice(0, 120);
        }
        return null;
    }

    const first = typeof json.first_name === "string" ? json.first_name.trim() : "";
    const last = typeof json.last_name === "string" ? json.last_name.trim() : "";
    const full = `${first} ${last}`.trim();
    return full ? full.slice(0, 120) : null;
}

/** Parser puro (testável) da resposta User Profile da Meta. */
export function parseMetaChannelUserProfileFromGraph(
    channel: "instagram" | "messenger",
    json: Record<string, unknown>
): MetaChannelUserProfile | null {
    const displayName = buildDisplayNameFromGraph(channel, json);
    const profilePicUrl = readMetaProfilePicUrl(json);
    if (!displayName && !profilePicUrl) return null;

    return {
        displayName,
        username:
            channel === "instagram" && typeof json.username === "string"
                ? json.username
                : null,
        profilePicUrl,
    };
}

/**
 * User Profile API — IGSID ou PSID com page access token.
 * @see https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/
 */
export async function fetchMetaChannelUserProfileResult(params: {
    channel: "instagram" | "messenger";
    userId: string;
    pageId: string;
    accessToken: string;
}): Promise<MetaProfileFetchResult> {
    const userId = params.userId.trim();
    const pageId = params.pageId.trim();
    const accessToken = params.accessToken.trim();
    if (!userId || !pageId || !accessToken) return { ok: false };

    const fields =
        params.channel === "instagram"
            ? "name,username,profile_pic"
            : "first_name,last_name,profile_pic";
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(userId)}?fields=${fields}`;

    const result = await metaGraphGetJson(pageId, url, { accessToken });
    if (!result.ok) {
        const errObj = result.json?.error as { message?: string } | undefined;
        console.warn("[meta/profile] fetch_failed", {
            channel: params.channel,
            status: result.status,
            error: errObj?.message ?? `graph_${result.status}`,
        });
        return { ok: false };
    }

    return {
        ok: true,
        profile: parseMetaChannelUserProfileFromGraph(params.channel, result.json),
    };
}

/** Atalho: perfil ou null. Falha de rede e perfil vazio caem no mesmo null. */
export async function fetchMetaChannelUserProfile(
    params: Parameters<typeof fetchMetaChannelUserProfileResult>[0]
): Promise<MetaChannelUserProfile | null> {
    const result = await fetchMetaChannelUserProfileResult(params);
    if (!result.ok) return null;
    return result.profile;
}
