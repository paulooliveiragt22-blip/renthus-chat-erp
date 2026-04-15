import fs from "node:fs";

const n = process.argv[2] ?? "2";
const out = process.argv[3];
const raw = fs.readFileSync(`scripts/_mcp_apply_payload_${n}.json`, "utf8");
const text = JSON.stringify(JSON.parse(raw));
if (out) fs.writeFileSync(out, text);
else process.stdout.write(text);
