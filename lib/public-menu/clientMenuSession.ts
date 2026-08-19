"use client";

import type { PublicMenuSessionOk } from "@/src/types/contracts.public-menu";

const jsonHeaders = { "Content-Type": "application/json" };

export async function postMenuSession(
    slug: string,
    body: { wmToken?: string; phone?: string; name?: string }
): Promise<PublicMenuSessionOk | { ok: false; error: string }> {
    try {
        const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/session`, {
            method: "POST",
            headers: jsonHeaders,
            credentials: "include",
            body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as
            | PublicMenuSessionOk
            | { ok: false; error: string }
            | null;
        if (!json || typeof json !== "object") {
            return { ok: false, error: "session_invalid" };
        }
        return json;
    } catch {
        return { ok: false, error: "session_invalid" };
    }
}

export async function getMenuSession(
    slug: string
): Promise<PublicMenuSessionOk | { ok: false; error: string }> {
    try {
        const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/session`, {
            credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as
            | PublicMenuSessionOk
            | { ok: false; error: string }
            | null;
        if (!json || typeof json !== "object") {
            return { ok: false, error: "session_invalid" };
        }
        return json;
    } catch {
        return { ok: false, error: "session_invalid" };
    }
}

/** UTM ou origem conhecida — orienta fallback (wa.me vs Direct). */
export function detectMenuChannelHint(): "whatsapp" | "instagram" | "messenger" | "unknown" {
    try {
        const utm = new URLSearchParams(globalThis.location.search)
            .get("utm_source")
            ?.trim()
            .toLowerCase();
        if (utm === "instagram") return "instagram";
        if (utm === "messenger") return "messenger";
        if (utm === "whatsapp") return "whatsapp";
    } catch {
        /* ignore */
    }
    return "unknown";
}
