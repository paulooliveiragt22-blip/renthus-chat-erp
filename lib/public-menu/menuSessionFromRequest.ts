import type { NextRequest } from "next/server";
import { menuSessionCookieName } from "./menuSessionCookie";

/** Lê `sessionToken` do body (preferido) ou cookie HttpOnly. */
export function resolveMenuSessionTokenFromRequest(
    req: NextRequest,
    slug: string,
    bodyToken?: string | null
): string {
    const fromBody = typeof bodyToken === "string" ? bodyToken.trim() : "";
    if (fromBody) return fromBody;
    return req.cookies.get(menuSessionCookieName(slug))?.value?.trim() ?? "";
}
