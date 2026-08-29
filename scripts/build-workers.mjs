/**
 * Bundle + zip Lambda workers (ADR-0003).
 * Usage: node scripts/build-workers.mjs
 */

import { mkdirSync, rmSync, existsSync, createWriteStream } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "dist", "workers");

function resolveTs(baseWithoutExt) {
    for (const ext of [".ts", ".tsx", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"]) {
        const candidate = baseWithoutExt + ext;
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

const pathAliasPlugin = {
    name: "path-alias",
    setup(build) {
        build.onResolve({ filter: /^@\// }, (args) => {
            const resolved = resolveTs(join(root, args.path.slice(2)));
            if (!resolved) {
                return { errors: [{ text: `Cannot resolve ${args.path}` }] };
            }
            return { path: resolved };
        });
    },
};

const entries = [
    { name: "inbound", entry: join(root, "workers", "inbound", "handler.ts") },
    { name: "outbound", entry: join(root, "workers", "outbound", "handler.ts") },
];

if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

for (const { name, entry } of entries) {
    const dir = join(outDir, name);
    const outfile = join(dir, "index.js");
    mkdirSync(dir, { recursive: true });

    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        platform: "node",
        target: "node20",
        format: "cjs",
        outfile,
        sourcemap: false,
        minify: true,
        plugins: [pathAliasPlugin],
        alias: {
            "server-only": join(root, "workers", "shims", "server-only.js"),
            "@sentry/nextjs": join(root, "workers", "shims", "sentry-nextjs.js"),
        },
        logLevel: "info",
        external: [],
    });

    const zipPath = join(outDir, `${name}.zip`);
    await zipDir(dir, zipPath);
    console.log(`built ${name} → ${outfile} + ${zipPath}`);
}

console.log("OK dist/workers/{inbound,outbound}.zip");

function zipDir(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
        const output = createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });
        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}
