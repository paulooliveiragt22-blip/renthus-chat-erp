// app/api/print/agents/[id]/download/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { validateAndConsumeToken, decryptText, cleanupToken } from "@/lib/print/download";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: { id: string } }) {
    const token = (new URL(req.url)).searchParams.get("token");
    const platform = (new URL(req.url)).searchParams.get("platform") || "windows";
    if (!token) return NextResponse.json({ error: "token_required" }, { status: 400 });

    // validate token and mark used
    try {
        const validRow: any = await validateAndConsumeToken(params.id, token);
        if (!validRow) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 403 });

        // decrypt api_key
        const encrypted = validRow.encrypted_api_key;
        const apiKeyPlain = decryptText(encrypted);

        // assemble zip and stream
        const distDir = path.resolve(process.cwd(), "print-agent-dist");
        const binaryMap: any = {
            windows: path.join(distDir, "printAgent-win.exe"),
            linux: path.join(distDir, "printAgent-linux"),
            macos: path.join(distDir, "printAgent-macos")
        };
        const binPath = binaryMap[platform];
        if (!fs.existsSync(binPath)) {
            // cleanup token
            await cleanupToken(validRow.id);
            return NextResponse.json({ error: "binary_not_available_for_platform" }, { status: 500 });
        }

        // build config
        const config = {
            API_BASE: process.env.API_BASE || ((req.url) ? new URL(req.url).origin + "/api/print" : ""),
            AGENT_KEY: apiKeyPlain,
            AGENT_PORT: 4001,
            DEFAULT_PRINTER_CONFIG_PATH: "printers.json"
        };

        // create a stream Response
        const stream = new TransformStream();
        const archive = archiver("zip", { zlib: { level: 9 } });

        archive.on("error", err => {
            console.error("archive error", err);
            try { archive.abort(); } catch { }
        });

        // pipe archive to transform stream
        const writer = archive.pipe(new (require("stream").PassThrough)());

        // Start archive and append files
        archive.file(binPath, { name: path.basename(binPath) });
        archive.append(JSON.stringify(config, null, 2), { name: "config/config.json" });

        // optional: include install scripts from repo
        const installDir = path.join(process.cwd(), "tools", "print-agent", "install");
        if (fs.existsSync(installDir)) {
            const installFiles = fs.readdirSync(installDir);
            for (const fname of installFiles) {
                const p = path.join(installDir, fname);
                archive.file(p, { name: `install/${fname}` });
            }
        }

        // finalize and return streaming response
        archive.finalize();

        // convert node stream to Web Response stream
        const responseStream = new ReadableStream({
            start(controller) {
                writer.on("data", (chunk: Buffer) => controller.enqueue(chunk));
                writer.on("end", () => controller.close());
                writer.on("error", (err: any) => controller.error(err));
            }
        });

        const headers = new Headers();
        headers.set("Content-Type", "application/zip");
        headers.set("Content-Disposition", `attachment; filename=print-agent-${platform}-${params.id}.zip`);

        return new Response(responseStream, { headers });
    } catch (e: any) {
        console.error("download route error", e);
        return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
    }
}
