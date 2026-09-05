import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/admin-alerts/adapters/webPushSender";

export const runtime = "nodejs";

/** Chave pública VAPID para PushManager.subscribe (sem auth — só public). */
export async function GET() {
    const key = getVapidPublicKey();
    if (!key) {
        return NextResponse.json({ error: "vapid_not_configured" }, { status: 503 });
    }
    return NextResponse.json({ publicKey: key });
}
