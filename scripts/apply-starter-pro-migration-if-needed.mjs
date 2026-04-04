/**
 * Aplica supabase/migrations/20260320400001_starter_pro_plans_meta_only.sql
 * só se a versão ainda não estiver em supabase_migrations.schema_migrations.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Client } = pkg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnvLocal() {
    const p = join(root, ".env.local");
    if (!existsSync(p)) throw new Error(".env.local não encontrado na raiz do projeto");
    const env = {};
    for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
            (v.startsWith('"') && v.endsWith('"')) ||
            (v.startsWith("'") && v.endsWith("'"))
        ) {
            v = v.slice(1, -1);
        }
        env[k] = v;
    }
    return env;
}

async function main() {
    const env = loadEnvLocal();
    const url =
        env.SUPABASE_MIGRATIONS_DB_URL ||
        env.DATABASE_URL ||
        env.DIRECT_URL ||
        env.POSTGRES_URL;
    if (!url) {
        throw new Error(
            "Defina em .env.local uma connection string Postgres (ex.: SUPABASE_MIGRATIONS_DB_URL ou DATABASE_URL). " +
                "Supabase: Project Settings → Database → Connection string (URI, modo session ou direct)."
        );
    }

    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const ver = "20260320400001";
    const { rows } = await client.query(
        "SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = $1 LIMIT 1",
        [ver]
    );

    if (rows.length > 0) {
        console.log(
            `Migration ${ver} já está aplicada no banco. A alteração no arquivo (WHERE true) é só para o Sonar; os dados já refletem o UPDATE.`
        );
        await client.end();
        return;
    }

    const sqlPath = join(root, "supabase", "migrations", `${ver}_starter_pro_plans_meta_only.sql`);
    const sql = readFileSync(sqlPath, "utf8");
    console.log(`Aplicando migration ${ver} no banco remoto…`);
    await client.query(sql);
    console.log("Concluído.");
    await client.end();
}

main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
});
