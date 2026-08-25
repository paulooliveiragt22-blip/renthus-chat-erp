import type { NextRequest } from "next/server";
import { checkRateLimitByIpAsync } from "@/lib/security/rateLimitDistributed";
import { requesterIp as requesterIpFromSecurity } from "@/lib/security/rateLimit";

export { requesterIpFromSecurity as requesterIp };

export async function publicMenuRateLimit(
    req: NextRequest,
    bucket: string,
    limit: number,
    windowMs = 60_000
) {
    return checkRateLimitByIpAsync(bucket, req, limit, windowMs);
}
