/** Print only key kind (sk_live/sk_test/…) — never the secret. */
import { existsSync, readFileSync } from "node:fs";

const keys = ["PAGARME_API_KEY", "NEXT_PUBLIC_PAGARME_PUBLIC_KEY"];
const files = [".env.local", ".env.pagarme.local"];

function kindOf(v) {
  if (!v) return "EMPTY";
  if (v.startsWith("sk_live_")) return "sk_live";
  if (v.startsWith("sk_test_")) return "sk_test";
  if (v.startsWith("pk_live_")) return "pk_live";
  if (v.startsWith("pk_test_")) return "pk_test";
  return "OTHER_PREFIX";
}

for (const f of files) {
  if (!existsSync(f)) {
    console.log(`${f}: missing`);
    continue;
  }
  const t = readFileSync(f, "utf8");
  for (const k of keys) {
    const m = t.match(new RegExp(`^${k}=(.*)$`, "m"));
    if (!m) {
      console.log(`${f} ${k}: ABSENT`);
      continue;
    }
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    console.log(
      `${f} ${k}: ${kindOf(v)} len=${v.length}` +
        ` starts_sk=${v.startsWith("sk_")} starts_pk=${v.startsWith("pk_")}` +
        ` has_live=${v.includes("live")} has_test=${v.includes("test")}` +
        ` first3=${JSON.stringify(v.slice(0, 3))}`,
    );
  }
}
