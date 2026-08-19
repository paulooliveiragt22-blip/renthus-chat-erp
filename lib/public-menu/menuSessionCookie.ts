import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

/** Cookie HttpOnly por slug — valor = `sessionToken` assinado. */
export function menuSessionCookieName(slug: string): string {
    return `renthus_menu_sess_${slug}`;
}

export const MENU_SESSION_COOKIE_MAX_AGE_SEC = 24 * 60 * 60;

export function setMenuSessionCookie(
    response: NextResponse,
    slug: string,
    sessionToken: string
): void {
    response.cookies.set(menuSessionCookieName(slug), sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: MENU_SESSION_COOKIE_MAX_AGE_SEC,
    });
}

export function clearMenuSessionCookie(response: NextResponse, slug: string): void {
    response.cookies.set(menuSessionCookieName(slug), "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
}

export async function readMenuSessionCookie(slug: string): Promise<string | null> {
    const jar = await cookies();
    const raw = jar.get(menuSessionCookieName(slug))?.value?.trim();
    return raw || null;
}
