/**
 * Gera CHATBOT_FLUXO_CRIACAO_PEDIDO_PT.pdf na raiz — diagramas estilo arquitetura
 * (fundo escuro, caixas, setas azuis) + texto curto.
 *
 * node scripts/generateFluxoPedidoChatbotPdf.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
/** Ficheiro de saida (fecha PDFs antigos no IDE se der EBUSY). */
const OUT = join(ROOT, "CHATBOT_FLUXO_PEDIDO_E_DRAFT_PT.pdf");

const W_MM = 210;
const H_MM = 297;
const M_MM = 12;

const SVG_W = 1400;
const SVG_H = 520;

/** Evita quebra de XML em <text> */
function esc(t) {
    return String(t)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

const ARROW_DEFS = `
  <defs>
    <marker id="ab" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#4a9eff"/>
    </marker>
  </defs>`;

function box(x, y, w, h, label, sub) {
    const fs = sub ? 13 : 16;
    const subEl = sub
        ? `<text x="${x + w / 2}" y="${y + h / 2 + 14}" fill="#b8bcc8" font-size="11" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">${esc(
              sub
          )}</text>`
        : "";
    return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#2d323c" stroke="#6b7288" stroke-width="2"/>
    <text x="${x + w / 2}" y="${y + h / 2 + 5}" fill="#f3f4f6" font-size="${fs}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="600">${esc(
        label
    )}</text>
    ${subEl}`;
}

function arrow(x1, y1, x2, y2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#4a9eff" stroke-width="3.5" marker-end="url(#ab)"/>`;
}

function region(x, y, w, h, title) {
    return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="none" stroke="#5b6578" stroke-width="2" stroke-dasharray="8 6"/>
    <text x="${x + 14}" y="${y + 28}" fill="#93c5fd" font-size="15" font-family="Segoe UI, Arial, sans-serif" font-weight="600">${esc(
        title
    )}</text>`;
}

function wrapTitle(main, sub) {
    return `
    <text x="700" y="42" fill="#e5e7eb" font-size="22" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${esc(
        main
    )}</text>
    <text x="700" y="68" fill="#9ca3af" font-size="13" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">${esc(sub)}</text>`;
}

function svgFrame(inner) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
  <rect width="100%" height="100%" fill="#12141a"/>
  ${ARROW_DEFS}
  ${inner}
</svg>`;
}

async function svgToPngDataUrl(svg) {
    const png = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
}

async function addDiagramPage(doc, titleMm, subtitleMm, svg) {
    doc.addPage();
    doc.setFillColor(18, 20, 26);
    doc.rect(0, 0, W_MM, H_MM, "F");
    doc.setTextColor(230, 232, 238);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(titleMm, M_MM, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(160, 165, 178);
    const subLines = doc.splitTextToSize(subtitleMm, W_MM - 2 * M_MM);
    doc.text(subLines, M_MM, 22);

    const dataUrl = await svgToPngDataUrl(svg);
    const imgW = W_MM - 2 * M_MM;
    const imgH = (SVG_H / SVG_W) * imgW;
    const top = 30;
    doc.addImage(dataUrl, "PNG", M_MM, top, imgW, Math.min(imgH, H_MM - top - M_MM));
}

function diagramIngressWorker() {
    const inner =
        wrapTitle(
            "Ingresso e worker (fila)",
            "incoming/route.ts | process-queue/route.ts | processMessage.ts"
        ) +
        region(36, 100, 560, 360, "ingress") +
        region(640, 100, 720, 360, "worker") +
        box(80, 180, 200, 72, "WhatsApp", "Meta webhook") +
        box(320, 180, 200, 72, "chatbot_queue", "Supabase") +
        arrow(280, 216, 320, 216) +
        box(700, 180, 220, 72, "process-queue", "GET + cron") +
        box(980, 180, 260, 72, "processInboundMessage", "lib/chatbot/processMessage.ts") +
        arrow(560, 216, 700, 216) +
        arrow(920, 216, 980, 216) +
        box(700, 300, 540, 88, "Proximo: tier PRO + runProPipeline", "CHATBOT_PRO_PIPELINE_V2=1");
    return svgFrame(inner);
}

function diagramTierBranch() {
    const inner =
        wrapTitle("Escolha do motor", "Apos processInboundMessage") +
        box(120, 130, 320, 80, "getChatbotProductTier", "lib/chatbot/tier.ts") +
        box(520, 130, 360, 80, "Plano PRO + V2 activo?", "env + Supabase plans") +
        arrow(440, 170, 520, 170) +
        box(200, 280, 420, 100, "runProPipeline", "src/pro/pipeline/runProPipeline.ts") +
        box(720, 280, 480, 100, "runInboundChatbotPipeline (legado)", "lib/chatbot/inboundPipeline.ts") +
        arrow(700, 170, 420, 280) +
        arrow(760, 210, 960, 280);
    return svgFrame(inner);
}

function diagramRunProPipeline() {
    const inner =
        wrapTitle("Pipeline PRO V2 (ordem real)", "Um turno por mensagem inbound") +
        region(40, 95, 1320, 400, "runProPipeline.ts") +
        box(60, 150, 118, 52, "loadState", null) +
        box(190, 150, 118, 52, "enrich", "customer") +
        box(320, 150, 100, 52, "slot", "step") +
        box(440, 150, 88, 52, "guard", null) +
        box(548, 150, 100, 52, "strict", "CTA") +
        box(666, 150, 92, 52, "quick", null) +
        box(778, 150, 100, 52, "intent", null) +
        box(898, 150, 92, 52, "order", null) +
        box(1010, 150, 88, 52, "route", null) +
        box(1118, 150, 88, 52, "AI", null) +
        box(1226, 150, 110, 52, "checkout", null) +
        arrow(178, 176, 190, 176) +
        arrow(308, 176, 320, 176) +
        arrow(418, 176, 440, 176) +
        arrow(528, 176, 548, 176) +
        arrow(648, 176, 666, 176) +
        arrow(758, 176, 778, 176) +
        arrow(878, 176, 898, 176) +
        arrow(990, 176, 1010, 176) +
        arrow(1098, 176, 1118, 176) +
        arrow(1206, 176, 1226, 176) +
        box(420, 292, 560, 92, "persistAndEmit", "save sessao + envia WhatsApp") +
        arrow(1281, 202, 700, 292) +
        `<text x="700" y="415" fill="#9ca3af" font-size="12" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">strict / quick / preOrder (resposta cedo) tambem chamam persistAndEmit e SAEM antes de route/AI</text>`;
    return svgFrame(inner);
}

function diagramDraftLifecycle() {
    const inner =
        wrapTitle("OrderDraft (rascunho)", "O pedido NA LOJA so nasce no orderStage + RPC; ate la e so estado") +
        box(60, 120, 360, 88, "Inicio do turno", "loadState: draft vindo do DB ou null") +
        box(460, 120, 420, 88, "Durante IA (ai.service.full)", "tools search / hints / prepare_order_draft") +
        box(920, 120, 400, 88, "Estado em RAM", "nextState.draft actualizado") +
        arrow(420, 164, 460, 164) +
        arrow(880, 164, 920, 164) +
        box(200, 260, 520, 92, "applyQuickAction / strict", "pode mudar pagamento ou bloquear sem IA") +
        box(780, 260, 520, 92, "checkoutPostProcess", "botoes + resolveProStepFromDraft") +
        arrow(700, 208, 460, 260) +
        arrow(900, 208, 1040, 260) +
        box(340, 390, 720, 88, "FIM do turno: persistAndEmit", "grava context.__pro_v2_state com draft (session.repository.supabase)") +
        arrow(520, 352, 520, 390) +
        arrow(1040, 352, 800, 390) +
        `<text x="700" y="500" fill="#93c5fd" font-size="13" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif">Criar pedido (orders): orderStage + OrderServiceV2Adapter + create_order_with_items — depois draft = null</text>`;
    return svgFrame(inner);
}

function diagramProSteps() {
    const inner =
        wrapTitle("Estados ProStep (checkout)", "Contrato: src/types/contracts.ts") +
        box(60, 140, 130, 56, "pro_idle", null) +
        box(220, 140, 160, 56, "pro_collecting", "order") +
        box(400, 140, 200, 56, "await addr", "confirm") +
        box(620, 140, 200, 56, "await payment", "botoes") +
        box(840, 140, 170, 56, "await change", "opc.") +
        box(1030, 140, 200, 56, "await confirm", "resumo") +
        arrow(190, 168, 220, 168) +
        arrow(380, 168, 400, 168) +
        arrow(600, 168, 620, 168) +
        arrow(820, 168, 840, 168) +
        arrow(1010, 168, 1030, 168) +
        box(320, 280, 760, 100, "orderStage + createFromDraft", "order.service.v2.ts -> RPC create_order_with_items") +
        arrow(700, 196, 700, 280);
    return svgFrame(inner);
}

function diagramOrderClose() {
    const inner =
        wrapTitle("Confirmacao no sistema", "So apos draft validado no servidor") +
        box(100, 140, 280, 88, "orderStage.ts", "pro_awaiting_confirmation") +
        box(440, 140, 320, 88, "OrderServiceV2Adapter", "validate + endereco RPC") +
        box(820, 140, 420, 88, "create_order_with_items", "Supabase RPC") +
        arrow(380, 184, 440, 184) +
        arrow(760, 184, 820, 184) +
        box(360, 300, 680, 88, "Resposta ao cliente", "buildOrderCustomerMessage + WhatsApp");
    return svgFrame(inner);
}

function diagramDataStores() {
    const inner =
        wrapTitle("Dados e falhas comuns", "Onde o estado vive") +
        region(40, 100, 620, 360, "Supabase") +
        region(700, 100, 660, 360, "externo") +
        box(80, 170, 240, 72, "chatbot_sessions", "JSON PRO state") +
        box(360, 170, 260, 72, "chatbot_queue", "jobs") +
        box(80, 280, 540, 72, "RPCs pedido / endereco", "views + policies") +
        box(740, 170, 280, 72, "Anthropic", "IA + classificador") +
        box(1060, 170, 260, 72, "Meta WhatsApp", "envio") +
        box(740, 280, 580, 72, "Risco: concorrencia na fila", "mesmo threadId sem lock");
    return svgFrame(inner);
}

function coverPage(doc) {
    doc.setFillColor(18, 20, 26);
    doc.rect(0, 0, W_MM, H_MM, "F");
    doc.setTextColor(243, 244, 246);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Fluxo de criacao de pedido", M_MM, 55);
    doc.setFontSize(14);
    doc.text("Chatbot WhatsApp — diagramas + referencia de codigo", M_MM, 68);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text("renthus-chat-erp — gerado " + new Date().toISOString().slice(0, 10), M_MM, 80);
    doc.setFontSize(8);
    const note = doc.splitTextToSize(
        "As figuras seguem o estilo arquitetura (fundo escuro, caixas, setas). Texto ASCII nos rotulos por limitacao de fonte no PDF; o significado esta nos ficheiros indicados.",
        W_MM - 2 * M_MM
    );
    doc.text(note, M_MM, 92);
}

function addTextPage(doc, title, lines) {
    doc.addPage();
    doc.setFillColor(245, 246, 250);
    doc.rect(0, 0, W_MM, H_MM, "F");
    doc.setFillColor(41, 98, 255);
    doc.rect(0, 0, W_MM, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(title, M_MM, 14);
    doc.setTextColor(30, 30, 36);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let y = 32;
    for (const line of lines) {
        for (const part of doc.splitTextToSize(line, W_MM - 2 * M_MM)) {
            if (y > H_MM - M_MM) {
                doc.addPage();
                doc.setFillColor(245, 246, 250);
                doc.rect(0, 0, W_MM, H_MM, "F");
                y = M_MM;
            }
            doc.text(part, M_MM, y);
            y += 4.5;
        }
        y += 2;
    }
}

async function main() {
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    coverPage(doc);

    await addDiagramPage(
        doc,
        "Figura 1 — Ingresso e worker",
        "Replica a estrutura do teu print: WhatsApp -> fila -> cron processa -> processInboundMessage.",
        diagramIngressWorker()
    );

    await addDiagramPage(
        doc,
        "Figura 2 — Ramo PRO vs legado",
        "processMessage.ts: se plano PRO e CHATBOT_PRO_PIPELINE_V2=1 corre deps.factory + runProPipeline; senao inboundPipeline.",
        diagramTierBranch()
    );

    await addDiagramPage(
        doc,
        "Figura 3 — Stages do runProPipeline",
        "Ordem em runProPipeline.ts. persistAndEmit em TODOS os exits (curtos ou fluxo completo).",
        diagramRunProPipeline()
    );

    await addDiagramPage(
        doc,
        "Figura 3b — Ciclo do OrderDraft",
        "Rascunho = OrderDraft (contracts.ts). Pedido real = RPC so no orderStage.",
        diagramDraftLifecycle()
    );

    addTextPage(doc, "Detalhe: o que cada caixa faz (1/2)", [
        "loadState (stages/loadState.ts): le chatbot_sessions; devolve ProSessionState incl. draft (ou null se nunca houve PRO neste thread).",
        "enrich (enrichCustomerFromPhone.ts): preenche customerId pelo telefone; nao constroi catalogo nem draft.",
        "slot (orderSlotStep.ts): withResolvedSlotStepUnlessAwaitingConfirmation — alinha ProStep ao draft (ex.: itens+endereco sem pagamento => awaiting address). Nao altera items do draft.",
        "guard (stages/guardRails.ts): bloqueia inbound vazio ou conversa em handover. Sem alteracao de draft.",
        "strict (checkoutPostProcess.ts strictCheckoutStructuredGate): se pagamento/endereco exigem botoes, responde sem IA; draft normalmente igual.",
        "quick (applyQuickAction): ids pro_pay_*, confirmar endereco, cancelar, etc. AQUI altera-se draft (pagamento) ou limpa-se tudo (cancelar).",
        "intent (intentStage + intentClassifier): so classifica mensagem (order_intent, human, ...). NAO le nem escreve draft.",
    ]);

    addTextPage(doc, "Detalhe: o que cada caixa faz (2/2)", [
        "order (orderStage.ts): so com step=pro_awaiting_confirmation + texto/botao de confirmacao explicita. AQUI corre createFromDraft (order.service.v2) => RPC create_order_with_items. Sucesso: step idle + draft=null. Falha: mensagem + step pode voltar a collecting.",
        "route (routeStage.ts): human_intent => handover; catalogo/status => flow ou texto; senao mode ai ou direct. Pode mudar step em handover.",
        "AI (aiStage + ai.service.full.ts): Claude + tools. prepare_order_draft (prepareOrderDraft.ts) valida itens/endereco/pagamento no servidor e devolve OrderDraft canónico. Draft fica no estado em memoria ate persistAndEmit.",
        "checkout (checkoutPostProcess): acrescenta botoes WhatsApp e resolveProStepFromDraft no estado.",
        "persistAndEmit (stages/persistAndEmit.ts): sessionRepo.save grava __pro_v2_state; messageGateway envia cada OutboundMessage.",
    ]);

    await addDiagramPage(
        doc,
        "Figura 4 — ProStep ate fecho",
        "orderSlotStep.ts alinha step ao draft; orderStage chama RPC quando cliente confirma.",
        diagramProSteps()
    );

    await addDiagramPage(
        doc,
        "Figura 5 — Pedido na base",
        "order.service.v2.ts: validacao, endereco, create_order_with_items.",
        diagramOrderClose()
    );

    await addDiagramPage(
        doc,
        "Figura 6 — Dados e escala",
        "Persistencia de sessao; fila; risco de corrida sem serializacao por thread.",
        diagramDataStores()
    );

    addTextPage(doc, "Ficheiros-chave (indice)", [
        "Webhook + fila: app/api/whatsapp/incoming/route.ts | app/api/chatbot/process-queue/route.ts",
        "Entrada motor: lib/chatbot/processMessage.ts | lib/chatbot/tier.ts",
        "Pipeline PRO: src/pro/pipeline/runProPipeline.ts | deps.factory.ts | stages/*.ts",
        "Rascunho + tools: lib/chatbot/pro/prepareOrderDraft.ts | searchProdutos.ts | orderHints.ts",
        "IA: src/pro/adapters/ai/ai.service.full.ts | stripModelIntentSuffix.ts",
        "Checkout CTAs: src/pro/pipeline/stages/checkoutPostProcess.ts",
        "Contratos: src/types/contracts.ts",
        "Regenerar este PDF: node scripts/generateFluxoPedidoChatbotPdf.mjs",
    ]);

    const buf = doc.output("arraybuffer");
    try {
        writeFileSync(OUT, Buffer.from(buf));
    } catch (e) {
        if (e && e.code === "EBUSY") {
            const alt = join(ROOT, `CHATBOT_FLUXO_CRIACAO_PEDIDO_DIAGRAMAS_${Date.now()}.pdf`);
            writeFileSync(alt, Buffer.from(buf));
            console.log("Ficheiro original bloqueado; escrito:", alt);
            return;
        }
        throw e;
    }
    console.log("Escrito:", OUT);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
