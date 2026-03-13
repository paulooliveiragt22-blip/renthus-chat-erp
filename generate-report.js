// Script para gerar o relatório de diagnóstico em PDF
// Uso: node generate-report.js

const { jsPDF } = require("./node_modules/jspdf/dist/jspdf.node.js");
const fs = require("fs");
const path = require("path");

const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

const W = 210;
const MARGIN = 18;
const CONTENT_W = W - MARGIN * 2;
const LINE_H = 6;

let y = 0;

function newPage() {
  doc.addPage();
  y = 20;
}

function checkY(needed = 10) {
  if (y + needed > 275) newPage();
}

function title(text) {
  checkY(14);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 90, 180);
  doc.text(text, MARGIN, y);
  y += 9;
  doc.setDrawColor(30, 90, 180);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 5;
  doc.setTextColor(0, 0, 0);
}

function h2(text) {
  checkY(10);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20, 60, 140);
  doc.text(text, MARGIN, y);
  y += 7;
  doc.setTextColor(0, 0, 0);
}

function h3(text) {
  checkY(8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(50, 50, 50);
  doc.text(text, MARGIN, y);
  y += 6;
  doc.setTextColor(0, 0, 0);
}

function para(text, indent = 0) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const lines = doc.splitTextToSize(text, CONTENT_W - indent);
  lines.forEach((line) => {
    checkY(LINE_H);
    doc.text(line, MARGIN + indent, y);
    y += LINE_H;
  });
}

function bullet(text, level = 0) {
  const indent = 4 + level * 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  const bullet_char = level === 0 ? "\u2022" : "\u25E6";
  const lines = doc.splitTextToSize(text, CONTENT_W - indent - 5);
  lines.forEach((line, i) => {
    checkY(LINE_H);
    if (i === 0) doc.text(bullet_char, MARGIN + indent, y);
    doc.text(line, MARGIN + indent + 5, y);
    y += LINE_H;
  });
}

function code(text) {
  checkY(LINE_H + 2);
  doc.setFont("courier", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(20, 100, 20);
  doc.setFillColor(245, 250, 245);
  const lines = doc.splitTextToSize(text, CONTENT_W - 4);
  const boxH = lines.length * 5 + 4;
  checkY(boxH);
  doc.roundedRect(MARGIN, y - 3, CONTENT_W, boxH, 2, 2, "F");
  lines.forEach((line) => {
    doc.text(line, MARGIN + 3, y);
    y += 5;
  });
  y += 2;
  doc.setTextColor(40, 40, 40);
}

function badge(text, type = "warn") {
  const colors = {
    ok: [40, 160, 80],
    warn: [200, 120, 0],
    err: [200, 40, 40],
    info: [30, 100, 200],
  };
  const [r, g, b] = colors[type] || colors.info;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(r, g, b);
  doc.text(text, MARGIN + 2, y);
  y += 5.5;
  doc.setTextColor(40, 40, 40);
}

function tableRow(cols, widths, isHeader = false) {
  checkY(8);
  doc.setFont("helvetica", isHeader ? "bold" : "normal");
  doc.setFontSize(9);
  if (isHeader) {
    doc.setFillColor(30, 90, 180);
    doc.setTextColor(255, 255, 255);
    doc.rect(MARGIN, y - 5, CONTENT_W, 7, "F");
  } else {
    doc.setTextColor(40, 40, 40);
  }
  let x = MARGIN + 2;
  cols.forEach((col, i) => {
    doc.text(String(col), x, y);
    x += widths[i];
  });
  y += 7;
  if (!isHeader) {
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y - 1, W - MARGIN, y - 1);
  }
  doc.setTextColor(40, 40, 40);
}

function space(mm = 4) {
  y += mm;
}

// ─── CAPA ────────────────────────────────────────────────────────────────────
doc.setFillColor(20, 60, 150);
doc.rect(0, 0, W, 60, "F");

doc.setFont("helvetica", "bold");
doc.setFontSize(24);
doc.setTextColor(255, 255, 255);
doc.text("Diagnóstico Técnico", MARGIN, 28);
doc.setFontSize(14);
doc.setFont("helvetica", "normal");
doc.text("Renthus Chat ERP — Chatbot Disk Bebidas WhatsApp", MARGIN, 38);

doc.setFontSize(10);
doc.setTextColor(180, 210, 255);
doc.text("Gerado em: " + new Date().toLocaleDateString("pt-BR", {
  day: "2-digit", month: "long", year: "numeric"
}), MARGIN, 50);

y = 75;

// ─── 1. ESTRUTURA ────────────────────────────────────────────────────────────
title("1. Estrutura do Projeto");
para("Aplicação Next.js 14 com App Router, backend via Route Handlers, banco Supabase (PostgreSQL) e integração WhatsApp dual-provider.");
space(2);
h2("Árvore de diretórios relevante");
code(
`renthus-chat-erp/
├── app/
│   ├── (admin)/          → UI: pedidos, produtos, relatórios, billing
│   ├── api/
│   │   ├── whatsapp/     → webhooks, send, threads, mensagens
│   │   ├── chatbot/      → resolve (classificação de intenção)
│   │   ├── billing/      → status, upgrade, allow-overage
│   │   ├── orders/       → CRUD + estatísticas
│   │   └── print/        → agentes e jobs de impressão
│   └── login/ + auth/
├── components/whatsapp/  → WhatsAppInbox.tsx (816 linhas)
├── lib/supabase/         → admin.ts, server.ts
└── supabase/migrations/  → 25+ arquivos de migração`
);
space(2);
h2("Stack tecnológico");
bullet("Frontend: Next.js 14, React 18, TailwindCSS, Recharts");
bullet("Backend: Node.js Runtime via Next.js Route Handlers");
bullet("Banco de dados: Supabase (PostgreSQL + PostgREST)");
bullet("WhatsApp: Twilio SDK v5.11.1 + 360dialog (Meta Graph API v20.0)");
bullet("PDF: jsPDF v4 + jsPDF-AutoTable");
bullet("Auth: Supabase SSR + OAuth callback");

// ─── 2. BIBLIOTECA WHATSAPP ───────────────────────────────────────────────────
title("2. Biblioteca WhatsApp Usada");
para("O projeto implementa arquitetura dual-provider: suporta tanto Twilio quanto 360dialog. A seleção é automática via campo provider na tabela whatsapp_channels.");
space(2);

const colW = [50, 55, 68];
tableRow(["Provider", "Integração", "Webhook URL"], colW, true);
tableRow(["Twilio", "SDK oficial v5.11.1", "/api/whatsapp/incoming"], colW);
tableRow(["360dialog", "HTTP direto → Meta Graph API", "/api/whatsapp/webhook"], colW);
space(4);

h2("Exemplo de roteamento por provider");
code(
`// app/api/whatsapp/send/route.ts
if (channel.provider === "twilio") {
  const client = twilio(accountSid, authToken);
  await client.messages.create({ from, to, body });
} else {
  // 360dialog via fetch → Meta Graph API v20.0
  await fetch(\`https://graph.facebook.com/v20.0/\${phoneNumberId}/messages\`, {
    method: 'POST',
    headers: { Authorization: \`Bearer \${DIALOG_TOKEN}\` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body } })
  });
}`
);

// ─── 3. FLUXO DE CONVERSA ─────────────────────────────────────────────────────
title("3. Fluxo de Conversa Existente");
h2("Fluxo atual (incompleto)");
code(
`Cliente envia mensagem WhatsApp
         ↓
Webhook recebe (Twilio ou 360dialog)
         ↓
Salva thread + mensagem no Supabase
         ↓
  ← AQUI O PIPELINE PARA →
  (chatbot NÃO é chamado automaticamente)
         ↓  [chamada manual necessária]
POST /api/chatbot/resolve
         ↓
Classifica intenção: keyword matching simples
  • Percorre bot_intents.examples[]
  • text.toLowerCase().includes(example.toLowerCase())
  • confidence = 0.9 se match | 0.0 se não
         ↓
┌─ Match → responde com response_template
└─ Sem match → action: "handover" (sem destino real)`
);
space(2);
h2("Problema central");
para("Os webhooks de entrada (incoming/route.ts e webhook/route.ts) salvam a mensagem no banco mas NÃO disparam o chatbot. O endpoint /api/chatbot/resolve existe como rota isolada — ninguém o chama automaticamente após uma mensagem do cliente chegar.");

// ─── 4. O QUE FALTA PARA PRODUÇÃO ─────────────────────────────────────────────
title("4. O Que Falta para Funcionar em Produção");

h2("4.1 Variáveis de ambiente ausentes");
para("As credenciais dos providers WhatsApp não estão configuradas no .env.local. Sem elas, nenhuma mensagem pode ser enviada:");
code(
`# Ausentes no .env.local — OBRIGATÓRIAS:
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

DIALOG_TOKEN=EAAxxxxxxxx
DIALOG_PHONE_NUMBER_ID=1234567890
DIALOG_BASE_URL=https://graph.facebook.com/v20.0`
);
space(2);

h2("4.2 Funções RPC do Supabase não implementadas");
para("O código de envio chama funções PostgreSQL que não existem nas migrations. Qualquer tentativa de enviar mensagem vai retornar erro 500:");
code(
`-- Chamadas no código, mas NÃO definidas no banco:
check_and_increment_usage(p_company, p_feature, p_amount)
decrement_monthly_usage(p_company, p_feature, p_amount)
increment_usage_monthly(p_company_id, p_feature_key)`
);
space(2);

h2("4.3 Loop automático do chatbot inexistente");
para("Os webhooks não disparam o bot. Falta adicionar ao final de cada webhook handler:");
code(
`// Após inserir mensagem no DB — adicionar em incoming/route.ts e webhook/route.ts:
fetch(\`\${process.env.NEXT_PUBLIC_APP_URL}/api/chatbot/resolve\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ threadId, messageId, companyId })
});`
);
space(2);

h2("4.4 Worker de impressão não implementado");
para("A tabela print_jobs recebe registros com status 'pending', mas nenhum worker ou cron processa esses jobs. Pedidos que deveriam imprimir ficam parados indefinidamente.");

// ─── 5. PONTOS CRÍTICOS ────────────────────────────────────────────────────────
title("5. Pontos Críticos a Corrigir");

h2("🔴 Alta Prioridade — Bloqueiam funcionamento básico");
space(1);

h3("a) Constraint única errada em whatsapp_threads");
para("Existe um índice UNIQUE somente em phone_e164 (sem company_id). Isso impede que duas empresas diferentes atendam o mesmo número de telefone, quebrando o multi-tenant:");
code(
`-- Remover constraint problemática:
DROP INDEX IF EXISTS whatsapp_threads_phone_e164_key;
-- O índice composto correto já existe nas migrations recentes:
-- UNIQUE (company_id, phone_e164)`
);
space(2);

h3("b) Billing sem RPCs — toda mensagem falha");
para("A rota de envio faz RPC call antes de despachar. Sem as funções no banco, o HTTP 500 é garantido em produção. Necessário criar as funções de billing no Supabase SQL Editor.");
space(2);

h3("c) Handover sem destino");
para("Quando o bot não reconhece a intenção, retorna action: 'handover' mas não faz nada concreto — não notifica atendente, não marca thread como 'aguardando humano', não envia mensagem ao cliente. O cliente fica no vácuo.");
space(3);

h2("🟡 Média Prioridade — Impactam experiência");
space(1);

h3("d) Colunas duplicadas em order_items");
para("A tabela order_items tem dois campos para quantidade: 'quantity' (integer) e 'qty' (numeric). Ambos coexistem na schema, causando inconsistência nas queries e potenciais bugs nos totais de pedidos.");
space(2);

h3("e) Keyword matching frágil para delivery");
para("Uma busca por 'heinekin 600' não vai encontrar o intent 'heineken'. Erratas, abreviações e variações de escrita comuns em WhatsApp vão fazer o bot falhar com frequência.");
space(2);

h3("f) Sem estado de conversa (sessão do chatbot)");
para("O bot não mantém contexto entre mensagens. Cada mensagem é tratada isoladamente — impossível implementar um fluxo 'Ver cardápio → escolher produto → confirmar pedido' sem uma tabela de sessão.");

// ─── 6. SUGESTÕES DE MELHORIA ─────────────────────────────────────────────────
title("6. Sugestões de Melhoria — Experiência do Cliente");

h2("Fluxo recomendado para disk bebidas");
code(
`1. BOAS-VINDAS (qualquer mensagem inicial)
   → "Olá! Sou o bot da [Loja]. O que deseja?"
   → Botões interativos: [Ver cardápio] [Meu pedido] [Falar com atendente]

2. CARDÁPIO (comando: ver cardápio)
   → Lista categorias → produtos com preços do banco
   → "Qual item deseja adicionar ao carrinho?"

3. CARRINHO (seleção de produto)
   → "Adicionei X. Deseja mais alguma coisa?"
   → [Continuar comprando] [Finalizar pedido]

4. CHECKOUT
   → Confirma endereço salvo OU pede endereço (cliente novo)
   → Forma de pagamento: Pix | Dinheiro | Cartão na entrega
   → Resumo do pedido + confirmação final

5. CONFIRMAÇÃO
   → Cria registro em orders no banco
   → Envia recibo formatado via WhatsApp
   → Notifica atendente no painel admin (badge/som)

6. ACOMPANHAMENTO
   → Cliente envia "status" ou "meu pedido" a qualquer momento
   → Bot consulta última order por phone_e164
   → Responde: "Seu pedido está: Em preparo / Saiu para entrega"`
);
space(3);

h2("Implementação prática do estado de sessão");
para("Criar tabela chatbot_sessions para manter contexto entre mensagens:");
code(
`CREATE TABLE chatbot_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid REFERENCES whatsapp_threads(id),
  company_id  uuid REFERENCES companies(id),
  step        text NOT NULL DEFAULT 'welcome',
  cart        jsonb NOT NULL DEFAULT '[]',
  customer_id uuid REFERENCES customers(id),
  expires_at  timestamptz DEFAULT now() + interval '2 hours',
  updated_at  timestamptz DEFAULT now()
);`
);
space(3);

h2("Outras melhorias de alto impacto");
space(1);

h3("Busca fonética de produtos");
bullet("Usar pg_trgm (PostgreSQL) para busca por similaridade: 'heinekin' encontra 'Heineken'");
bullet("Alternativa: normalizar texto removendo acentos antes de comparar");
space(2);

h3("Notificação automática de status");
bullet("Quando atendente altera pedido para 'Saiu para entrega' → enviar msg automática ao cliente");
bullet("Integrar com hook de UPDATE na tabela orders");
space(2);

h3("Horário de funcionamento");
bullet("Bot responde 'Estamos fechados. Abrimos às HH:MM' fora do horário configurado");
bullet("Configurar por empresa: dias da semana + horário em companies.config (jsonb)");
space(2);

h3("Template de boas-vindas (24h window)");
bullet("Usar WhatsApp Business Template Messages para contato iniciado pelo cliente");
bullet("Obrigatório para enviar mensagens após 24h sem interação do cliente");

// ─── TABELA RESUMO ────────────────────────────────────────────────────────────
title("Resumo de Maturidade do Projeto");
space(1);

const cW = [68, 30, 50];
tableRow(["Componente", "Status", "Prioridade"], cW, true);

const rows = [
  ["Multi-tenant / Autenticação", "✓ Pronto", "—"],
  ["Recebimento de mensagens (webhooks)", "✓ Pronto", "—"],
  ["Interface do inbox (UI)", "✓ Pronto", "—"],
  ["Envio de mensagens", "⚠ Falta credenciais", "🔴 Imediato"],
  ["Billing / RPCs no banco", "✗ Não implementado", "🔴 Imediato"],
  ["Loop automático do chatbot", "✗ Ausente", "🔴 Imediato"],
  ["Fluxo de pedido via chat", "✗ Não existe", "🟡 Próx. sprint"],
  ["Worker de impressão", "✗ Incompleto", "🟡 Próx. sprint"],
  ["Chatbot com estado (sessão)", "✗ Não existe", "🟡 Próx. sprint"],
  ["Busca fonética de produtos", "✗ Não existe", "🟢 Melhoria"],
  ["Notificação de status ao cliente", "✗ Não existe", "🟢 Melhoria"],
];

rows.forEach(([comp, status, prio]) => {
  tableRow([comp, status, prio], cW);
});

space(6);

// Rodapé
doc.setFont("helvetica", "italic");
doc.setFontSize(8);
doc.setTextColor(150, 150, 150);
doc.text(
  "Diagnóstico gerado automaticamente • Renthus Chat ERP • " +
    new Date().toLocaleDateString("pt-BR"),
  MARGIN,
  285
);
doc.line(MARGIN, 282, W - MARGIN, 282);

// ─── SALVAR ───────────────────────────────────────────────────────────────────
const outputPath = path.join(__dirname, "diagnostico-renthus.pdf");
const buffer = Buffer.from(doc.output("arraybuffer"));
fs.writeFileSync(outputPath, buffer);

console.log("✅ PDF gerado com sucesso:", outputPath);
console.log("   Tamanho:", (buffer.length / 1024).toFixed(1), "KB");
