import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

export function requesterIp(req: NextRequest): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim();
    return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function publicMenuRateLimit(
    req: NextRequest,
    bucket: string,
    limit: number,
    windowMs = 60_000
) {
    return checkRateLimit(`${bucket}:${requesterIp(req)}`, limit, windowMs);
}
