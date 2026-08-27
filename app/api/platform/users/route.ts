import { NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/platform/apiHelpers";
import { listPlatformUsers } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

export async function GET() {
    return withPlatformAccess("platform.users.manage", async (ctx) => {
        const users = await listPlatformUsers(ctx.admin);
        return NextResponse.json({ users });
    });
}
