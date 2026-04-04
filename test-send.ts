import * as fs from "fs";
import * as path from "path";

// Carrega .env.local manualmente (sem depender de Next.js ou dotenv)
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replaceAll(/^["']|["']$/g, "");
        process.env[key] = val;
    }
    console.log(".env.local carregado.\n");
}

const TOKEN          = process.env.WHATSAPP_TOKEN;
const PHONE_ID       = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TO             = "5566992285005";
const TEXT           = "Teste direto";
const GRAPH_API_BASE = "https://graph.facebook.com/v20.0";

async function main() {
    if (!TOKEN || !PHONE_ID) {
        console.error("❌ WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não encontrados no .env.local");
        process.exit(1);
    }

    const url = `${GRAPH_API_BASE}/${PHONE_ID}/messages`;

    const body = {
        messaging_product: "whatsapp",
        to:   TO,
        type: "text",
        text: { body: TEXT },
    };

    console.log("→ URL:   ", url);
    console.log("→ Para:  ", TO);
    console.log("→ Texto: ", TEXT);
    console.log("→ Payload:", JSON.stringify(body, null, 2));
    console.log();

    const res = await fetch(url, {
        method:  "POST",
        headers: {
            Authorization:  `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);

    console.log(`← Status HTTP: ${res.status} ${res.statusText}`);
    console.log("← Response completo:");
    console.log(JSON.stringify(json, null, 2));

    if (res.ok) {
        console.log("\n✅ Mensagem enviada! message_id:", json?.messages?.[0]?.id);
    } else {
        console.log("\n❌ Erro:", json?.error?.message ?? "desconhecido");
    }
}

main().catch((err) => {
    console.error("Erro inesperado:", err);
    process.exit(1);
});
