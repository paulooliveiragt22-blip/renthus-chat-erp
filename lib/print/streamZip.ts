// lib/print/streamZip.ts
import fs from "fs";
import path from "path";
import archiver from "archiver";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function streamAgentZip(agentId: string, apiKeyPlain: string, req: Request, platform = "windows") {
    const admin = createAdminClient();
    const { data: agent } = await admin.from("print_agents").select("*").eq("id", agentId).maybeSingle();
    if (!agent) return NextResponse.json({ error: "agent_not_found" }, { status: 404 });

    const distDir = path.resolve(process.cwd(), "print-agent-dist");
    const binaryMap: any = {
        windows: path.join(distDir, "printAgent-win.exe"),
        linux: path.join(distDir, "printAgent-linux"),
        macos: path.join(distDir, "printAgent-macos")
    };
    const binPath = binaryMap[platform];
    if (!fs.existsSync(binPath)) return NextResponse.json({ error: "binary_not_available_for_platform" }, { status: 500 });

    const config = {
        API_BASE: process.env.API_BASE || ((req.url) ? new URL(req.url).origin + "/api/print" : ""),
        AGENT_KEY: apiKeyPlain,
        AGENT_PORT: 4001,
        DEFAULT_PRINTER_CONFIG_PATH: "printers.json"
    };

    // create streaming Response similar to previous route (see that file)
    const writer = new (require("stream").PassThrough)();
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(writer);
    archive.file(binPath, { name: path.basename(binPath) });
    archive.append(JSON.stringify(config, null, 2), { name: "config/config.json" });

    const installDir = path.join(process.cwd(), "tools", "print-agent", "install");
    if (fs.existsSync(installDir)) {
        for (const fname of fs.readdirSync(installDir)) {
            archive.file(path.join(installDir, fname), { name: `install/${fname}` });
        }
    }
    archive.finalize();

    const responseStream = new ReadableStream({
        start(controller) {
            writer.on("data", (chunk: Buffer) => controller.enqueue(chunk));
            writer.on("end", () => controller.close());
            writer.on("error", (err: any) => controller.error(err));
        }
    });

    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename=print-agent-${platform}-${agentId}.zip`);
    return new Response(responseStream, { headers });
}
