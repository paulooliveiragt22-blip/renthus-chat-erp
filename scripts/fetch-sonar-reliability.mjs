#!/usr/bin/env node
/**
 * Baixa issues do SonarCloud com paginação (SonarCloud API).
 *
 * Modos:
 *   (padrão)        api/issues/search types=BUG → Reliability (abertos)
 *   --code-smell    types=CODE_SMELL → Maintainability / code smells (abertos)
 *   --quality       types=BUG,CODE_SMELL → Reliability + Maintainability num único JSON
 *   --hotspots      api/hotspots/search → Security Hotspots
 *                (SECURITY_HOTSPOT não existe em issues/search; só CODE_SMELL, BUG, VULNERABILITY)
 *
 * Variáveis de ambiente (obrigatórias):
 *   SONAR_TOKEN, SONARCLOUD_ORGANIZATION, SONARCLOUD_PROJECT_KEY
 *   (aliases: SONARQUBE_TOKEN, SONAR_ORGANIZATION, SONAR_PROJECT_KEY)
 *
 * Opcionais:
 *   SONAR_OUT  — caminho do JSON (default depende do modo)
 *
 * Flags:
 *   --csv       — também grava CSV (.csv ao lado do JSON)
 *   --hotspots     — Security Hotspots (api/hotspots/search)
 *   --code-smell   — code smells abertos (Maintainability)
 *   --quality      — BUG + CODE_SMELL abertos (um arquivo)
 *
 * Env files (carregados se existirem, sem sobrescrever o shell):
 *   .env.sonar.local, .env.local, .env
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function stripQuotes(val) {
    if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
    ) {
        return val.slice(1, -1);
    }
    return val;
}

/** Uma linha chave=valor do .env (já trimada na entrada). */
function applyEnvLine(line) {
    if (!line || line.startsWith("#")) return;
    let s = line;
    if (s.startsWith("export ")) s = s.slice(7).trim();
    const eq = s.indexOf("=");
    if (eq <= 0) return;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    val = stripQuotes(val);
    if (process.env[key] === undefined) process.env[key] = val;
}

/** Dotenv mínimo: não substitui variáveis já definidas no ambiente (ex.: PowerShell). */
function loadDotEnvFiles(paths) {
    for (const filePath of paths) {
        if (!existsSync(filePath)) continue;
        const text = readFileSync(filePath, "utf8");
        for (let line of text.split(/\r?\n/)) {
            applyEnvLine(line.trim());
        }
    }
}

loadDotEnvFiles([
    resolve(root, ".env.sonar.local"),
    resolve(root, ".env.local"),
    resolve(root, ".env"),
]);

const argSet = new Set(process.argv.slice(2));
const wantHotspots = argSet.has("--hotspots");
const wantCodeSmell = argSet.has("--code-smell");
const wantQuality = argSet.has("--quality");
const wantCsv = argSet.has("--csv");

const token =
    process.env.SONAR_TOKEN?.trim() ||
    process.env.SONARQUBE_TOKEN?.trim();
const organization =
    process.env.SONARCLOUD_ORGANIZATION?.trim() ||
    process.env.SONAR_ORGANIZATION?.trim();
const projectKey =
    process.env.SONARCLOUD_PROJECT_KEY?.trim() ||
    process.env.SONAR_PROJECT_KEY?.trim();

function defaultOutputBasename() {
    if (wantHotspots) return "sonar-security-hotspots.json";
    if (wantQuality) return "sonar-open-quality-issues.json";
    if (wantCodeSmell) return "sonar-code-smells.json";
    return "sonar-reliability-bugs.json";
}

const outJson = resolve(root, process.env.SONAR_OUT?.trim() || defaultOutputBasename());

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

async function fetchIssuesPage(page, types) {
    const url = new URL("https://sonarcloud.io/api/issues/search");
    url.searchParams.set("organization", organization);
    url.searchParams.set("componentKeys", projectKey);
    url.searchParams.set("types", types);
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
        throw new Error(`issues/search HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
}

/** Endpoint dedicado de hotspots (SonarCloud). */
async function fetchHotspotsSearchPage(page) {
    const url = new URL("https://sonarcloud.io/api/hotspots/search");
    url.searchParams.set("organization", organization);
    url.searchParams.set("projectKey", projectKey);
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
        throw new Error(`hotspots/search HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    return res.json();
}

function issueToRow(issue) {
    const comp = issue.component ?? "";
    const pathFromComp = comp.includes(":") ? comp.split(":").slice(1).join(":") : comp;
    return {
        key:       issue.key,
        rule:      issue.rule,
        severity:  issue.severity ?? "",
        type:      issue.type,
        status:    issue.status,
        message:   (issue.message ?? "").replaceAll("\n", " ").replaceAll("\r", ""),
        file:      pathFromComp,
        line:      issue.line ?? "",
        effort:    issue.effort ?? "",
        creation:  issue.creationDate ?? "",
        source:    "issues/search",
    };
}

function hotspotApiToRow(h) {
    const comp = h.component ?? "";
    const pathFromComp = comp.includes(":") ? comp.split(":").slice(1).join(":") : comp;
    return {
        key:       h.key,
        rule:      h.ruleKey ?? h.category ?? "",
        severity:  "",
        type:      "SECURITY_HOTSPOT",
        status:    h.status ?? "",
        message:   (h.message ?? "").replaceAll("\n", " ").replaceAll("\r", ""),
        file:      pathFromComp,
        line:      h.line ?? "",
        effort:    "",
        creation:  h.updateDate ?? h.creationDate ?? "",
        source:    "hotspots/search",
    };
}

function toCsv(rows) {
    const cols = ["key", "rule", "severity", "type", "status", "file", "line", "effort", "creation", "source", "message"];
    const esc = (v) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
        return s;
    };
    const header = cols.join(",");
    const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
    return `${header}\n${body}\n`;
}

function resolveIssueTypesParam() {
    if (wantHotspots) return "";
    if (wantQuality) return "BUG,CODE_SMELL";
    if (wantCodeSmell) return "CODE_SMELL";
    return "BUG";
}

const issueTypesParam = resolveIssueTypesParam();

async function fetchAllHotspotsRows() {
    let page = 1;
    const fromApi = [];
    let total = null;
    for (;;) {
        const data = await fetchHotspotsSearchPage(page);
        total = data.paging?.total ?? fromApi.length;
        const batch = data.hotspots ?? [];
        fromApi.push(...batch);
        process.stderr.write(`hotspots/search página ${page}: +${batch.length} (acumulado: ${fromApi.length} / ${total})\n`);
        if (batch.length === 0) break;
        if (fromApi.length >= total) break;
        page += 1;
    }
    return fromApi.map(hotspotApiToRow);
}

async function fetchAllIssueRows(types) {
    let page = 1;
    const allIssues = [];
    let total = null;
    for (;;) {
        const data = await fetchIssuesPage(page, types);
        total = data.paging?.total ?? allIssues.length;
        const batch = data.issues ?? [];
        allIssues.push(...batch);
        process.stderr.write(
            `issues/search [${types}] página ${page}: +${batch.length} (acumulado: ${allIssues.length} / ${total})\n`
        );
        if (batch.length === 0) break;
        if (allIssues.length >= total) break;
        page += 1;
    }
    return allIssues.map(issueToRow);
}

const rows = wantHotspots
    ? await fetchAllHotspotsRows()
    : await fetchAllIssueRows(issueTypesParam);

const payload = {
    fetchedAt:  new Date().toISOString(),
    organization,
    projectKey,
    typeFilter: wantHotspots ? "SECURITY_HOTSPOT" : issueTypesParam,
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
