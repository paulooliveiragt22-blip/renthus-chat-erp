import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { getSecurityOpsStatus } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.security.read", async () => {
        return NextResponse.json(getSecurityOpsStatus());
    });
}
