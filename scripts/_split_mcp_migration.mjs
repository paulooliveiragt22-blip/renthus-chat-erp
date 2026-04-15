import fs from "fs";

const p = "supabase/migrations/20260414240000_domain_admin_rpcs.sql";
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
const w = (path, slice) => fs.writeFileSync(path, slice.join("\n") + "\n", { encoding: "utf8" });
w("scripts/_mcp_domain_rpcs_1.sql", lines.slice(0, 313));
w("scripts/_mcp_domain_rpcs_2.sql", lines.slice(313, 467));
w("scripts/_mcp_domain_rpcs_3.sql", lines.slice(467));

const mk = (n, name) =>
    fs.writeFileSync(
        `scripts/_mcp_apply_${n}.json`,
        JSON.stringify({ name, query: fs.readFileSync(`scripts/_mcp_domain_rpcs_${n}.sql`, "utf8") })
    );
mk("1", "domain_admin_rpcs_part_1_orders_customers_expenses_bills");
mk("2", "domain_admin_rpcs_part_2_cash_drivers");
mk("3", "domain_admin_rpcs_part_3_pdv_finalize_grants");

const s = fs.readFileSync("scripts/_mcp_domain_rpcs_1.sql", "utf8");
console.log("ok", s.split("\n").slice(0, 2).join("|"));
