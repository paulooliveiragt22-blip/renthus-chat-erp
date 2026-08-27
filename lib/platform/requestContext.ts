import { headers } from "next/headers";
import { newRequestId } from "./audit/recordPlatformAudit";
import { extractClientIp } from "./checkPlatformIpAllowlist";

export type PlatformRequestContext = {
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

export async function getPlatformRequestContext(
    requestIdHeader?: string | null
): Promise<PlatformRequestContext> {
    const h = await headers();
    return {
        requestId: newRequestId(requestIdHeader ?? h.get("x-request-id")),
        ipAddress: extractClientIp(h.get("x-forwarded-for"), h.get("x-real-ip")),
        userAgent: h.get("user-agent"),
    };
}
