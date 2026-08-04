#!/usr/bin/env node
/**
 * Troca um código de pareamento pela API key do Print Agent.
 *
 * Uso:
 *   node scripts/print-agent-pair.mjs --url https://app.exemplo.com --code ABCD2345
 *
 * Grava .env.agent local (AGENT_KEY + API_BASE) se --write for passado.
 */

import { writeFileSync } from "node:fs";

function arg(name, fallback = "") {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
    return fallback;
}

const url = (arg("url") || process.env.API_BASE || "").replace(/\/$/, "");
const code = (arg("code") || "").trim().toUpperCase();
const write = process.argv.includes("--write");

if (!url || !code) {
    console.error("Uso: node scripts/print-agent-pair.mjs --url <ERP_URL> --code <CODIGO> [--write]");
    process.exit(1);
}

const res = await fetch(`${url}/api/agent/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
    console.error("Falha:", json.error || res.status);
    process.exit(1);
}

console.log("OK — agente pareado");
console.log("agent_id:", json.agent_id);
console.log("api_key:", json.api_key);
console.log("server:", json.server_url || url);

if (write) {
    const body = `API_BASE=${url}\nAGENT_KEY=${json.api_key}\n`;
    writeFileSync(".env.agent", body, "utf8");
    console.log("Gravado .env.agent");
}
