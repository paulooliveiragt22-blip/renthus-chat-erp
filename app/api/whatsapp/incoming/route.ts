import { NextResponse } from "next/server";
// webhook twilio test
// Twilio manda x-www-form-urlencoded :contentReference[oaicite:1]{index=1}
export async function POST(req: Request) {
    const form = await req.formData(); // funciona com x-www-form-urlencoded no runtime Web
    const from = String(form.get("From") || "");
    const body = String(form.get("Body") || "").trim();

    // Ex: From = "whatsapp:+55XXXXXXXXXXX"
    console.log("TWILIO IN:", { from, body });

    // Responder com TwiML (XML) é o jeito mais simples
    const reply = `Você disse: ${body}\n\nResponda 1 para ver o cardápio.`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(reply)}</Message>
</Response>`;

    return new NextResponse(twiml, {
        status: 200,
        headers: { "Content-Type": "text/xml" },
    });
}

// Evita quebrar XML
function escapeXml(input: string) {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
