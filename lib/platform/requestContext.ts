import { headers } from "next/headers";
import { newRequestId } from "./audit/recordPlatformAudit";
import { collectClientIpCandidates } from "./checkPlatformIpAllowlist";

export type PlatformRequestContext = {
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

export async function getPlatformRequestContext(
    requestIdHeader?: string | null
): Promise<PlatformRequestContext> {
    const h = await headers();
    const candidates = collectClientIpCandidates(h);
    return {
        requestId: newRequestId(requestIdHeader ?? h.get("x-request-id")),
        ipAddress: candidates[0] ?? "",
        userAgent: h.get("user-agent"),
    };
}
