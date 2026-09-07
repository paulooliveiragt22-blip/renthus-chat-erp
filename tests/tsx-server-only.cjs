/**
 * Shim só para `server-only` — NÃO redireciona `@/` para `.tests-dist`
 * (isso quebraria `tsx` com código fonte fresco).
 */
"use strict";
const path = require("path");
const Module = require("module");

const emptyModulePath = path.join(__dirname, "empty-module.cjs");
const origResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
    if (request === "server-only") return emptyModulePath;
    return origResolve.call(this, request, parent, isMain, options);
};
