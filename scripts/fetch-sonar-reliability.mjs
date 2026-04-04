#!/usr/bin/env node
/**
 * Baixa todos os issues de Reliability (type=BUG) do SonarCloud, com paginação.
 *
 * Variáveis de ambiente (obrigatórias):
 *   SONAR_TOKEN                  — token em My Account → Security (não commite)
 *   SONARCLOUD_ORGANIZATION      — chave da org (ex.: paulooliveiragt22-blip)
 *   SONARCLOUD_PROJECT_KEY       — chave do projeto (Project Information → Project Key)
 *
 * Opcionais:
 *   SONAR_OUT                    — caminho do JSON (default: ./sonar-reliability-bugs.json)
 *
 * Flags:
 *   --csv                        — também grava CSV ao lado do JSON (.csv)
 *
 * Também lê automaticamente (se existirem), sem sobrescrever o que já veio do shell:
 *   .env.sonar.local  → ideal só para token/chaves Sonar (gitignored se você adicionar)
 *   .env.local
 *   .env
 *
 * Exemplo (PowerShell — mesma janela em que roda npm):
 *   $env:SONAR_TOKEN="seu_token"
 *   $env:SONARCLOUD_ORGANIZATION="sua-org"
 *   $env:SONARCLOUD_PROJECT_KEY="sua-org_seu-repo"
 *   node scripts/fetch-sonar-reliability.mjs --csv
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** Dotenv mínimo: não substitui variáveis já definidas no ambiente (ex.: PowerShell). */
function loadDotEnvFiles(paths) {
    for (const filePath of paths) {
        if (!existsSync(filePath)) continue;
        const text = readFileSync(filePath, "utf8");
        for (let line of text.split(/\r?\n/)) {
            line = line.trim();
            if (!line || line.startsWith("#")) continue;
            if (line.startsWith("export ")) line = line.slice(7).trim();
            const eq = line.indexOf("=");
            if (eq <= 0) continue;
            const key = line.slice(0, eq).trim();
            let val = line.slice(eq + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            if (process.env[key] === undefined) process.env[key] = val;
        }
    }
}

loadDotEnvFiles([
    resolve(root, ".env.sonar.local"),
    resolve(root, ".env.local"),
    resolve(root, ".env"),
]);

const token =
    process.env.SONAR_TOKEN?.trim() ||
    process.env.SONARQUBE_TOKEN?.trim();
const organization =
    process.env.SONARCLOUD_ORGANIZATION?.trim() ||
    process.env.SONAR_ORGANIZATION?.trim();
const projectKey =
    process.env.SONARCLOUD_PROJECT_KEY?.trim() ||
    process.env.SONAR_PROJECT_KEY?.trim();
const wantCsv = process.argv.includes("--csv");
const outJson = resolve(root, process.env.SONAR_OUT?.trim() || "sonar-reliability-bugs.json");

if (!token || !organization || !projectKey) {
    console.error(
        "Defina SONAR_TOKEN, SONARCLOUD_ORGANIZATION e SONARCLOUD_PROJECT_KEY.\n" +
            "Opções: (1) no PowerShell com $env:... na mesma janela antes de npm run, ou\n" +
            "        (2) no .env.local na raiz do projeto (o script carrega automaticamente).\n" +
            "Chaves: SonarCloud → projeto → Project information.\n" +
            "Aliases aceitos: SONARQUBE_TOKEN, SONAR_ORGANIZATION, SONAR_PROJECT_KEY."
    );
    process.exit(1);
}

/** SonarCloud: usuário = token, senha vazia (Basic). */
function authHeader() {
    const b64 = Buffer.from(`${token}:`, "utf8").toString("base64");
    return `Basic ${b64}`;
}

async function fetchPage(page) {
    const url = new URL("https://sonarcloud.io/api/issues/search");
    url.searchParams.set("organization", organization);
    url.searchParams.set("componentKeys", projectKey);
    url.searchParams.set("types", "BUG");
    url.searchParams.set("statuses", "OPEN");
    url.searchParams.set("ps", "500");
    url.searchParams.set("p", String(page));

    const res = await fetch(url, {
        headers: {
            Authorization: authHeader(),
            Accept:        "application/json",
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
}

function issueToRow(issue) {
    const comp = issue.component ?? "";
    const pathFromComp = comp.includes(":") ? comp.split(":").slice(1).join(":") : comp;
    return {
        key:       issue.key,
        rule:      issue.rule,
        severity:  issue.severity,
        type:      issue.type,
        status:    issue.status,
        message:   (issue.message ?? "").replaceAll("\n", " ").replaceAll("\r", ""),
        file:      pathFromComp,
        line:      issue.line ?? "",
        effort:    issue.effort ?? "",
        creation:  issue.creationDate ?? "",
    };
}

function toCsv(rows) {
    const cols = ["key", "rule", "severity", "type", "status", "file", "line", "effort", "creation", "message"];
    const esc = (v) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
        return s;
    };
    const header = cols.join(",");
    const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
    return `${header}\n${body}\n`;
}

let page = 1;
const allIssues = [];
let total = null;

for (;;) {
    const data = await fetchPage(page);
    total = data.paging?.total ?? allIssues.length;
    const batch = data.issues ?? [];
    allIssues.push(...batch);

    process.stderr.write(`Página ${page}: +${batch.length} (total acumulado: ${allIssues.length} / ${total})\n`);

    if (batch.length === 0) break;
    if (allIssues.length >= total) break;
    page += 1;
}

const rows = allIssues.map(issueToRow);
const payload = {
    fetchedAt:  new Date().toISOString(),
    organization,
    projectKey,
    typeFilter: "BUG",
    total:      rows.length,
    issues:     rows,
};

mkdirSync(dirname(outJson), { recursive: true });
writeFileSync(outJson, JSON.stringify(payload, null, 2), "utf8");
console.log(`JSON: ${outJson}`);

if (wantCsv) {
    const outCsv = outJson.replace(/\.json$/i, "") + ".csv";
    writeFileSync(outCsv, toCsv(rows), "utf8");
    console.log(`CSV:  ${outCsv}`);
}
