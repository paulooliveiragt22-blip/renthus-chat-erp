/**
 * Pré-carregamento para `npm test` (Node sem Next):
 * - `server-only` → módulo vazio (o pacote oficial falha fora do bundler).
 * - `@/…` → ficheiros em `.tests-dist/` gerados pelo `tsc --project tsconfig.test.json`.
 */
const path   = require("path");
const fs     = require("fs");
const Module = require("module");

const projectRoot   = path.join(__dirname, "..");
const emptyModulePath = path.join(__dirname, "empty-module.cjs");
const testsDistRoot = path.join(projectRoot, ".tests-dist");

const origResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (request === "server-only") return emptyModulePath;

    if (typeof request === "string" && request.startsWith("@/")) {
        const rel        = request.slice(2);
        const withoutExt = path.join(testsDistRoot, rel);
        const candidates = [
            `${withoutExt}.js`,
            `${withoutExt}.cjs`,
            path.join(withoutExt, "index.js"),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return c;
        }
    }

    return origResolve.call(this, request, parent, isMain, options);
};
