/**
 * scripts/run-migrations.mjs
 * Executa migrations pendentes contra o banco remoto Supabase.
 *
 * Uso: node scripts/run-migrations.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.SUPABASE_MIGRATIONS_DB_URL;
if (!DB_URL) {
  throw new Error('SUPABASE_MIGRATIONS_DB_URL environment variable not set');
}

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

// Migrations a executar (ordenadas)
const MIGRATIONS = [
  '20260314100001_fix_critical_duplicate_indexes.sql',
  '20260314100002_fix_order_items_qty_sync.sql',
  '20260314100003_fix_orders_total_trigger.sql',
  '20260314100004_fix_companies_schema.sql',
  '20260314100005_fix_products_category_cleanup.sql',
  '20260314100006_fix_order_items_company_id.sql',
  '20260314100007_fix_medium_improvements.sql',
  '20260314100008_fix_updated_at_triggers.sql',
];

async function run() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    console.log('✅ Conectado ao banco remoto\n');

    for (const filename of MIGRATIONS) {
      const filepath = join(MIGRATIONS_DIR, filename);
      let sql;
      try {
        sql = readFileSync(filepath, 'utf8');
      } catch {
        console.warn(`⚠️  Arquivo não encontrado: ${filename} — pulando`);
        continue;
      }

      console.log(`▶  Executando: ${filename}`);
      try {
        await client.query(sql);
        console.log(`   ✅ OK\n`);
      } catch (err) {
        console.error(`   ❌ ERRO: ${err.message}`);
        console.error(`   SQL: ${sql.substring(0, 200)}...\n`);
        // Continua para próxima migration (idempotente)
      }
    }

    console.log('🎉 Migrations concluídas!');
  } catch (err) {
    console.error('❌ Falha na conexão:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
