#!/usr/bin/env bash
set -euo pipefail

echo "1) Criando branch chore/reorg-supabase-and-chatbot-ui"
git fetch origin
git checkout -b chore/reorg-supabase-and-chatbot-ui

# -------------------------
# 2) Overwrite lib/supabase/client.ts
# -------------------------
mkdir -p lib/supabase
cat > lib/supabase/client.ts <<'TS'
/**
 * lib/supabase/client.ts
 * Supabase client helpers (browser)
 * - createClient() -> fábrica (retorna um novo client)
 * - getSupabase() -> lazy singleton para uso em components cliente
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

let _cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_cachedClient) return _cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set these env vars in .env.local or Vercel."
    );
  }

  _cachedClient = createBrowserClient(url, anonKey);
  return _cachedClient;
}
TS

# -------------------------
# 3) Re-exports for compatibility
# -------------------------
cat > lib/supabaseClient.ts <<'TS'
/**
 * Backwards-compatible re-export: prefer import from "@/lib/supabase/client"
 */
export { getSupabase, createClient } from "./supabase/client";
TS

mkdir -p src/lib
cat > src/lib/supabaseClient.ts <<'TS'
/**
 * src/lib/supabaseClient.ts
 * Re-export to maintain compatibility for imports from src/
 */
export { getSupabase, createClient } from "@/lib/supabase/client";
TS

# -------------------------
# 4) Create app/chatbot/page.tsx (placeholder)
# -------------------------
mkdir -p app/chatbot
cat > app/chatbot/page.tsx <<'TSX'
import WhatsAppInbox from "@/components/whatsapp/WhatsAppInbox";

export default function ChatbotPage() {
  // Temporário: reaproveita a inbox do WhatsApp como placeholder do Chatbot.
  return <WhatsAppInbox />;
}
TSX

# -------------------------
# 5) Update components/AdminSidebar.tsx: WhatsApp -> Chatbot (UI)
# -------------------------
AS="components/AdminSidebar.tsx"
if [ -f "$AS" ]; then
  echo "Modificando $AS (WhatsApp -> Chatbot)"
  # 1) mudar state tab type
  perl -0777 -pe 's/const \[tab, setTab\] = useState<"orders" \| "whatsapp">/const [tab, setTab] = useState<"orders" | "chatbot">/s' -i "$AS" || true
  # 2) change hrefs / labels
  perl -0777 -pe 's/href="\/whatsapp"/href="\/chatbot"/g' -i "$AS"
  perl -0777 -pe 's/>WhatsApp</>Chatbot</g' -i "$AS"
  # 3) change occurrences of "whatsapp" in UI area to "chatbot" (only in this file)
  perl -0777 -pe 's/\bwhatsapp\b/chatbot/g' -i "$AS"
else
  echo "Aviso: $AS não existe. Pular etapa."
fi

# -------------------------
# 6) Replace createClient -> getSupabase in client components
# -------------------------
FILES=(
  "app/login/LoginClient.tsx"
  "app/(admin)/pedidos/PedidosClient.tsx"
  "app/(admin)/produtos/lista/ListaClient.tsx"
  "app/(admin)/produtos/page.tsx"
  "app/(admin)/layout.tsx"
)

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    echo "Atualizando $f"
    perl -0777 -pe 's/import\s*\{\s*createClient\s*\}\s*from\s*"(?:@\/lib\/supabase\/client|@\/lib\/supabaseClient)";/import { getSupabase } from "@/lib\/supabase\/client";/g' -i "$f"
    perl -0777 -pe 's/useMemo\(\s*\(\)\s*=>\s*createClient\(\)\s*,\s*\[\s*\]\s*\)/useMemo(() => getSupabase(), [])/g' -i "$f"
    # also replace instances importing createClient from "@/lib/supabase/client" with getSupabase
    perl -0777 -pe 's/import\s*\{\s*createClient\s*\}\s*from\s*"\@\/lib\/supabase\/client";/import { getSupabase } from "\@\/lib\/supabase\/client";/g' -i "$f"
  fi
done

# fallback: globally replace imports of "@/lib/supabaseClient" to "@/lib/supabase/client"
rg --hidden --glob '!node_modules' -n "from \"@/lib/supabaseClient\"" || true
perl -0777 -pe 's/from\s*"\@\/lib\/supabaseClient"/from "\@\/lib\/supabase\/client"/g' -i $(rg --hidden --glob '!node_modules' -l 'from "@/lib/supabaseClient"' || true) || true

# -------------------------
# 7) Git commit and push branch
# -------------------------
git add lib/supabase lib/supabaseClient.ts src/lib/supabaseClient.ts app/chatbot components/AdminSidebar.tsx || true
# add updated client-side files if exist
for f in "${FILES[@]}"; do
  [ -f "$f" ] && git add "$f"
done

git commit -m "chore: reorg supabase client (createClient/getSupabase), add Chatbot UI and update client imports" || true

echo "Pushing branch chore/reorg-supabase-and-chatbot-ui"
git push -u origin chore/reorg-supabase-and-chatbot-ui

# Create PR using gh CLI (assumes gh is authenticated)
echo "Creating PR with gh..."
gh pr create --title "chore: reorg supabase & add Chatbot UI" \
  --body "This PR standardizes the Supabase client (createClient/getSupabase), replaces WhatsApp menu with Chatbot (UI) and updates client-side consumers. Validation: npx tsc --noEmit; npm run build; manual smoke tests for /login, /pedidos, /produtos, /chatbot" \
  --base main || echo "gh pr create failed - please run it manually."

# -------------------------
# 8) Create migration/next-24 branch and update package.json
# -------------------------
git checkout main
git pull origin main
git checkout -b migration/next-24

# Update package.json: set next to "^24.0.0" and bump node engine (simple sed - may require manual review)
if [ -f package.json ]; then
  node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json","utf8"));
  p.dependencies = p.dependencies || {};
  p.dependencies.next = "^24.0.0";
  p.engines = p.engines || {};
  p.engines.node = ">=18";
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  console.log("package.json updated: next => ^24.0.0");
  '
  git add package.json
  git commit -m "chore(migration): bump next to ^24.0.0 and set engines.node >=18" || true
  git push -u origin migration/next-24
  echo "Created migration/next-24 branch and pushed package.json update."
  echo "Now try running 'npm ci' and 'npm run build' locally to surface migration issues."
else
  echo "package.json not found; skipping Next-24 package.json modification."
fi

echo "Done. Please review PRs on GitHub. Run locally: npx tsc --noEmit && npm run build && npm run dev to validate."
