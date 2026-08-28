import "server-only";

import { metaGraphGetJson } from "@/lib/whatsapp/metaGraphFetch";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION?.trim() || "v20.0";

export type MetaChannelUserProfile = {
    displayName: string;
    username?: string | null;
};

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
    if (!displayName) return null;

    return {
        displayName,
        username:
            channel === "instagram" && typeof json.username === "string"
                ? json.username
                : null,
    };
}

/**
 * User Profile API — IGSID ou PSID com page access token.
 * @see https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/
 */
export async function fetchMetaChannelUserProfile(params: {
    channel: "instagram" | "messenger";
    userId: string;
    pageId: string;
    accessToken: string;
}): Promise<MetaChannelUserProfile | null> {
    const userId = params.userId.trim();
    const pageId = params.pageId.trim();
    const accessToken = params.accessToken.trim();
    if (!userId || !pageId || !accessToken) return null;

    const fields =
        params.channel === "instagram" ? "name,username" : "first_name,last_name";
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(userId)}?fields=${fields}`;

    const result = await metaGraphGetJson(pageId, url, { accessToken });
    if (!result.ok) {
        const errObj = result.json?.error as { message?: string } | undefined;
        console.warn("[meta/profile] fetch_failed", {
            channel: params.channel,
            status: result.status,
            error: errObj?.message ?? `graph_${result.status}`,
        });
        return null;
    }

    return parseMetaChannelUserProfileFromGraph(params.channel, result.json);
}
