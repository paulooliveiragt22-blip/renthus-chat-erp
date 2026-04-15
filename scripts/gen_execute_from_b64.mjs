import fs from "fs";

const part = process.argv[2] || "1";
const raw = fs.readFileSync(`scripts/_mcp_domain_rpcs_${part}.sql`, "utf8");
const b64 = Buffer.from(raw, "utf8").toString("base64");
const chunkSize = 3500;
const chunks = [];
for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize));
}
const esc = (s) => s.replace(/'/g, "''");
const rows = chunks.map((c, idx) => `(${idx + 1}, '${esc(c)}')`).join(",\n    ");
const sql = `DO $ddl$
DECLARE
  payload text;
BEGIN
  payload := (
    SELECT string_agg(chunk, '' ORDER BY ord)
    FROM (VALUES
    ${rows}
    ) AS t(ord, chunk)
  );
  EXECUTE convert_from(decode(payload, 'base64'), 'UTF8');
END;
$ddl$;`;

fs.writeFileSync(`scripts/_mcp_execute_part_${part}.sql`, sql, "utf8");
console.log(`Wrote scripts/_mcp_execute_part_${part}.sql`, sql.length, "bytes");
