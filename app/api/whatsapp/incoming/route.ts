import { NextResponse } from "next/server";
import twilio from "twilio";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const form = await req.formData();
    const Body = String(form.get("Body") ?? "");

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`✅ OK! Recebi: ${Body || "(vazio)"}`);

    return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
}
