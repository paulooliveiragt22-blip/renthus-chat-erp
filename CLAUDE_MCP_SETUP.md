# Configuração de MCPs — Renthus Chat ERP

## Visão Geral

Este projeto já tem 4 MCPs configurados no Cursor. Alguns precisam de autenticação manual.

---

## MCPs Já Configurados (precisam apenas de autenticação)

### 1. Supabase MCP — ✅ Autenticado (supabase.com)
- **Arquivo:** `~/.cursor/mcp.json`
- **Status:** Pronto para uso
- **Ferramentas disponíveis:**
  - `execute_sql` — SQL raw (SELECT, INSERT, UPDATE, DELETE)
  - `apply_migration` — DDL migrations
  - `query_logs` — Logs do banco
  - `list_tables`, `list_migrations`, `list_extensions`
  - `create_branch`, `reset_branch`, `rebase_branch`
  - `deploy_edge_function`, `get_edge_function`
  - `generate_typescript_types`
  - `search_docs`, `get_advisors`
- **Se não aparecer na sessão:** Clique em **"Reload MCPs"** no Cursor (Cmd+Shift+P → "Reload")

### 2. Vercel MCP — ⚠️ Requer OAuth manual
- **Arquivo:** `~/.cursor/projects/c-Users-Usuario-Documents-renthus-chat-erp/mcps/project-0-renthus-chat-erp-vercel/`
- **Status:** Servidor instalado, aguardando login
- **O que fazer:**
  1. Na próxima vez que eu usar uma ferramenta do Vercel MCP, o Cursor vai abrir **um popup do browser**
  2. Faça login com sua conta Vercel (a que tem o projeto `renthus-chat-erp`)
  3. Clique em **"Authorize"** para conceder acesso
  4. Pronto — o MCP vai ficar autenticado permanentemente
- **Ferramentas que vão aparecer:**
  - `vercel_deploy` — Fazer deploy forçado
  - `vercel_logs` — Ver logs de funções serverless
  - `vercel_env` — Listar/modificar environment variables
  - `vercel_domain` — Configurar domínios customizados

### 3. AWS Serverless MCP — ✅ Configurado (já disponível nesta sessão)
- **Ferramentas disponíveis:** Lambda, SQS, CloudWatch, SAM deploy
- **Credenciais:** Usa as credenciais AWS já configuradas na máquina

### 4. Context7 MCP — ✅ Configurado
- **Uso:** Consultar documentação de bibliotecas (Next.js, Supabase, etc.)

---

## Como Verificar se os MCPs Estão Ativos

1. Abra o Cursor neste projeto
2. Pressione `Cmd+Shift+P` (macOS) ou `Ctrl+Shift+P` (Windows)
3. Digite: **"MCP"**
4. Escolha: **"MCP: Show MCP Resources"** ou **"MCP: View Tools"**
5. Você deve ver: `supabase`, `vercel`, `aws-serverless`, `context7`

## Como Forçar Reload dos MCPs

1. `Cmd+Shift+P` → **"MCP: Restart All Servers"**
2. Ou feche e reabra o Cursor

## Problema Comum: "No such tool" para Supabase

Se eu disser "No such tool" para uma ferramenta do Supabase, significa que a sessão atual
não carregou o MCP. Solução:
1. Cmd+Shift+P → **"MCP: Restart All Servers"**
2. Aguarde 5 segundos
3. Tente novamente

## Credenciais Necessárias

### Supabase
- O Supabase MCP usa **Project API Key** (não a senha do banco)
- A URL do projeto já está configurada: `https://zwcfuvohxmvlxhdfbgxo.supabase.co`
- A autenticação é feita via browser OAuth na primeira vez

### Vercel
- Token OAuth via browser (não precisa de token manual)
- Permissão necessária: `full-access` ou escopo do projeto `renthus-chat-erp`

---

## Próximos Passos Após Autenticação

Depois que Vercel OAuth estiver completo, vou poder:

1. **Verificar env vars de produção:**
   ```
   vercel env ls production
   ```
   → Confirmar `SQS_DISPATCH_ENABLED=1`, `SQS_INBOUND_QUEUE_URL`, credenciais AWS

2. **Forçar redeploy se necessário:**
   ```
   vercel --prod deploy --force
   ```

3. **Ver logs da função inbound:**
   ```
   vercel logs app/api/whatsapp/incoming
   ```

4. **Ver métricas dos workers Lambda:**
   ```
   aws lambda get-function --function-name renthus-inbound-worker
   ```

5. **Consultar banco diretamente:**
   ```sql
   -- Ver subscription da empresa
   SELECT * FROM pagarme_subscriptions WHERE company_id = 'e5865f09-7dce-4fce-afad-d9ab20031790';
   -- Ver fila pendente
   SELECT * FROM chatbot_queue WHERE company_id = 'e5865f09-7dce-4fce-afad-d9ab20031790' ORDER BY created_at DESC;
   ```
