/**
 * smoke-entitlements.js
 * Smoke test para entitlements/billing (usa pg)
 * Gere o DATABASE_URL no ambiente antes de rodar:
 * $env:DATABASE_URL = "postgres://usuario:senha@host:5432/nome_do_banco"
 *
 * Requisitos: npm i pg
 */

const { Client } = require("pg");

const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("ERRO: defina DATABASE_URL (postgres://user:pass@host:5432/db)");
  process.exit(1);
}

const client = new Client({ connectionString: DB });

async function ensureRpcFunctions() {
  const sql = `
  CREATE OR REPLACE FUNCTION public.check_and_increment_usage(
    p_company uuid,
    p_feature_key text,
    p_amount integer DEFAULT 1
  ) RETURNS jsonb
  LANGUAGE plpgsql AS
  $$
  DECLARE
    v_year_month text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
    v_allow_overage boolean := false;
    v_limit integer;
    v_addon integer := 0;
    v_used integer;
    v_next_used integer;
  BEGIN
    SELECT s.allow_overage, fl.limit_per_month
      INTO v_allow_overage, v_limit
    FROM subscriptions s
    LEFT JOIN feature_limits fl
      ON fl.plan_id = s.plan_id AND fl.feature_key = p_feature_key
    WHERE s.company_id = p_company AND s.status = 'active'
    ORDER BY s.started_at DESC
    LIMIT 1;

    SELECT COALESCE(quantity,0) INTO v_addon
    FROM subscription_addons
    WHERE company_id = p_company AND feature_key = p_feature_key
    LIMIT 1;

    SELECT used INTO v_used
    FROM usage_monthly
    WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month
    LIMIT 1;

    IF v_limit IS NULL THEN
      INSERT INTO usage_monthly(company_id, feature_key, year_month, used)
        VALUES (p_company, p_feature_key, v_year_month, p_amount)
      ON CONFLICT (company_id, feature_key, year_month)
      DO UPDATE SET used = usage_monthly.used + p_amount;
      SELECT used INTO v_used FROM usage_monthly WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month;
      RETURN json_build_object(
        'allowed', true,
        'feature_key', p_feature_key,
        'year_month', v_year_month,
        'used', v_used,
        'limit_per_month', NULL,
        'will_overage_by', 0,
        'allow_overage', COALESCE(v_allow_overage,false)
      );
    END IF;

    IF v_used IS NULL THEN
      v_used := 0;
      v_next_used := v_used + p_amount;
      IF v_next_used <= (v_limit + COALESCE(v_addon,0)) OR COALESCE(v_allow_overage,false) THEN
        INSERT INTO usage_monthly(company_id, feature_key, year_month, used)
          VALUES (p_company, p_feature_key, v_year_month, p_amount);
        SELECT used INTO v_used FROM usage_monthly WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month;
        RETURN json_build_object(
          'allowed', true,
          'feature_key', p_feature_key,
          'year_month', v_year_month,
          'used', v_used,
          'limit_per_month', v_limit,
          'will_overage_by', GREATEST(0, v_next_used - v_limit),
          'allow_overage', COALESCE(v_allow_overage,false)
        );
      ELSE
        RETURN json_build_object(
          'allowed', false,
          'feature_key', p_feature_key,
          'year_month', v_year_month,
          'used', v_used,
          'limit_per_month', v_limit,
          'will_overage_by', GREATEST(0, v_next_used - v_limit),
          'allow_overage', COALESCE(v_allow_overage,false)
        );
      END IF;
    ELSE
      v_next_used := v_used + p_amount;
      IF v_next_used <= (v_limit + COALESCE(v_addon,0)) OR COALESCE(v_allow_overage,false) THEN
        UPDATE usage_monthly
          SET used = used + p_amount
        WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month;
        SELECT used INTO v_used FROM usage_monthly WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month;
        RETURN json_build_object(
          'allowed', true,
          'feature_key', p_feature_key,
          'year_month', v_year_month,
          'used', v_used,
          'limit_per_month', v_limit,
          'will_overage_by', GREATEST(0, v_next_used - v_limit),
          'allow_overage', COALESCE(v_allow_overage,false)
        );
      ELSE
        RETURN json_build_object(
          'allowed', false,
          'feature_key', p_feature_key,
          'year_month', v_year_month,
          'used', v_used,
          'limit_per_month', v_limit,
          'will_overage_by', GREATEST(0, v_next_used - v_limit),
          'allow_overage', COALESCE(v_allow_overage,false)
        );
      END IF;
    END IF;
  END;
  $$;

  CREATE OR REPLACE FUNCTION public.decrement_monthly_usage(
    p_company uuid,
    p_feature_key text,
    p_amount integer DEFAULT 1
  ) RETURNS jsonb
  LANGUAGE plpgsql AS
  $$
  DECLARE
    v_year_month text := to_char(now() AT TIME ZONE 'utc', 'YYYY-MM');
    v_used integer := 0;
  BEGIN
    UPDATE usage_monthly
      SET used = GREATEST(used - p_amount, 0)
    WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month;

    SELECT COALESCE(used, 0) INTO v_used
      FROM usage_monthly
      WHERE company_id = p_company AND feature_key = p_feature_key AND year_month = v_year_month
      LIMIT 1;

    RETURN json_build_object(
      'feature_key', p_feature_key,
      'year_month', v_year_month,
      'used', v_used
    );
  END;
  $$;
  `;
  await client.query(sql);
  console.log("Funções RPC garantidas: check_and_increment_usage, decrement_monthly_usage");
}

async function seedMinimalPlanFeature() {
  const featureKey = "whatsapp_messages";
  const planKey = "smoke_mini_erp";
  await client.query(`INSERT INTO features(key, description) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [
    featureKey,
    "Mensagens WhatsApp por mês (smoke)",
  ]);

  let res = await client.query(`SELECT id FROM plans WHERE key = $1 LIMIT 1`, [planKey]);
  let planId;
  if (res.rowCount === 0) {
    res = await client.query(`INSERT INTO plans(key, name, description) VALUES ($1, $2, $3) RETURNING id`, [
      planKey,
      "Smoke Mini ERP",
      "Plano de teste smoke com limite de mensagens",
    ]);
    planId = res.rows[0].id;
  } else {
    planId = res.rows[0].id;
  }

  await client.query(
    `INSERT INTO plan_features(plan_id, feature_key)
     VALUES ($1, $2)
     ON CONFLICT (plan_id, feature_key) DO NOTHING`,
    [planId, featureKey]
  );
  await client.query(
    `INSERT INTO feature_limits(plan_id, feature_key, limit_per_month)
     VALUES ($1, $2, $3)
     ON CONFLICT (plan_id, feature_key) DO UPDATE SET limit_per_month = EXCLUDED.limit_per_month`,
    [planId, featureKey, 5]
  );

  return { planId, featureKey };
}

async function seedCompanySubscription(planId) {
  let res = await client.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, ["Smoke Company"]);
  let companyId;
  if (res.rowCount === 0) {
    res = await client.query(`INSERT INTO companies(name, city, phone) VALUES ($1, $2, $3) RETURNING id`, [
      "Smoke Company",
      "Sao Paulo",
      "000000000",
    ]);
    companyId = res.rows[0].id;
  } else {
    companyId = res.rows[0].id;
  }

  res = await client.query(`SELECT id FROM subscriptions WHERE company_id = $1 AND status = 'active' LIMIT 1`, [companyId]);
  let subscriptionId;
  if (res.rowCount === 0) {
    res = await client.query(
      `INSERT INTO subscriptions(company_id, plan_id, status, started_at, allow_overage)
       VALUES ($1, $2, 'active', now(), false)
       RETURNING id`,
      [companyId, planId]
    );
    subscriptionId = res.rows[0].id;
  } else {
    subscriptionId = res.rows[0].id;
    await client.query(`UPDATE subscriptions SET plan_id = $1 WHERE id = $2`, [planId, subscriptionId]);
    await client.query(`UPDATE subscriptions SET allow_overage = false WHERE id = $1`, [subscriptionId]);
  }

  return { companyId, subscriptionId };
}

async function getUsage(companyId, featureKey) {
  const ymRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'utc','YYYY-MM') AS ym`);
  const year_month = ymRes.rows[0].ym;
  const res = await client.query(
    `SELECT COALESCE(used,0) as used FROM usage_monthly WHERE company_id=$1 AND feature_key=$2 AND year_month=$3`,
    [companyId, featureKey, year_month]
  );
  const used = res.rowCount ? res.rows[0].used : 0;
  return { year_month, used };
}

async function runTests() {
  try {
    await client.connect();
    console.log("Conectado ao DB");

    await ensureRpcFunctions();

    const { planId, featureKey } = await seedMinimalPlanFeature();

    const { companyId, subscriptionId } = await seedCompanySubscription(planId);
    console.log({ companyId, subscriptionId });

    const ymRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'utc','YYYY-MM') AS ym`);
    const ym = ymRes.rows[0].ym;
    await client.query(`DELETE FROM usage_monthly WHERE company_id=$1 AND feature_key=$2 AND year_month=$3`, [
      companyId,
      featureKey,
      ym,
    ]);
    console.log("Uso mensal zerado para testes:", ym);

    console.log("\n--- TEST SCENARIOS ---");

    console.log("\nCenário: 1..5 -> devem ser permitidos");
    for (let i = 1; i <= 5; i++) {
      const res = await client.query(`SELECT check_and_increment_usage($1, $2, $3) AS r`, [companyId, featureKey, 1]);
      const r = res.rows[0].r;
      console.log(`Reserva #${i}: allowed=${r.allowed} used=${r.used} limit=${r.limit_per_month} will_overage_by=${r.will_overage_by}`);
      if (!r.allowed) {
        console.error("ERRO: Reserva foi negada inesperadamente no passo", i);
        break;
      }
    }

    let usage = await getUsage(companyId, featureKey);
    console.log("Uso atual após 5 reservas:", usage);

    console.log("\nCenário: 6 -> deve ser BLOQUEADO (allow_overage=false)");
    const sixth = await client.query(`SELECT check_and_increment_usage($1,$2,$3) AS r`, [companyId, featureKey, 1]);
    console.log("6º resultado:", sixth.rows[0].r);

    console.log("\nCenário: rollback (reserva + decrement_monthly_usage)");
    await client.query(`UPDATE usage_monthly SET used = 0 WHERE company_id=$1 AND feature_key=$2 AND year_month=$3`, [companyId, featureKey, ym]);
    console.log("Reserva 1 (deve passar)");
    const r1 = (await client.query(`SELECT check_and_increment_usage($1,$2,$3) AS r`, [companyId, featureKey, 1])).rows[0].r;
    console.log("Reserva result:", r1);
    console.log("Agora decrement (liberar) por 1");
    const dec = (await client.query(`SELECT decrement_monthly_usage($1,$2,$3) as r`, [companyId, featureKey, 1])).rows[0].r;
    console.log("Decrement result:", dec);
    usage = await getUsage(companyId, featureKey);
    console.log("Uso atual após decrement:", usage);

    console.log("\nCenário: allow_overage=true -> permitir além do limite");
    await client.query(`UPDATE subscriptions SET allow_overage = true WHERE id = $1`, [subscriptionId]);
    await client.query(`UPDATE usage_monthly SET used = 0 WHERE company_id=$1 AND feature_key=$2 AND year_month=$3`, [companyId, featureKey, ym]);
    for (let i = 1; i <= 10; i++) {
      const r = (await client.query(`SELECT check_and_increment_usage($1,$2,$3) AS r`, [companyId, featureKey, 1])).rows[0].r;
      console.log(`Reserva overage #${i}: allowed=${r.allowed} used=${r.used} will_overage_by=${r.will_overage_by}`);
      if (!r.allowed) {
        console.error("ERRO: Reserva com allow_overage=true foi negada inesperadamente:", r);
        break;
      }
    }
    usage = await getUsage(companyId, featureKey);
    console.log("Uso final com allow_overage=true:", usage);

    console.log("\n--- TESTS COMPLETED ---");

  } catch (err) {
    console.error("Erro no teste:", err);
  } finally {
    await client.end();
    console.log("Conexão encerrada.");
  }
}

runTests();
