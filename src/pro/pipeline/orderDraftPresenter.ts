/**
 * Resumo canónico do rascunho para o cliente (totais do servidor, não da IA).
 */

import type { OrderDraft } from "@/src/types/contracts";

function brl(n: number): string {
    return n.toFixed(2).replace(".", ",");
}

function paymentLabel(pm: OrderDraft["paymentMethod"]): string {
    if (pm === "pix") return "PIX";
    if (pm === "card") return "Cartao";
    if (pm === "cash") {
        return "Dinheiro";
    }
    return "—";
}

function addressLine(draft: OrderDraft): string {
    const a = draft.address;
    if (!a) return "—";
    return [
        a.logradouro,
        a.numero,
        a.complemento,
        a.bairroLabel ?? a.bairro,
        a.cidade,
        a.estado,
    ]
        .filter(Boolean)
        .join(", ");
}

/** Corpo do card de confirmação final (itens + taxa + total). */
export function formatCanonicalDraftSummary(draft: OrderDraft): string {
    const lines: string[] = ["*Resumo do pedido* (ainda nao confirmado):", ""];

    for (const it of draft.items) {
        const name = String(it.productName ?? "Item").trim() || "Item";
        const lineTotal = Number(it.unitPrice) * Number(it.quantity);
        lines.push(
            `• ${it.quantity}x ${name} — R$ ${brl(lineTotal)}`
        );
    }

    lines.push("");
    lines.push(`Subtotal itens: R$ ${brl(Number(draft.totalItems) || 0)}`);
    const fee = Number(draft.deliveryFee) || 0;
    if (fee > 0) {
        lines.push(`Taxa de entrega: R$ ${brl(fee)}`);
    } else {
        lines.push("Taxa de entrega: R$ 0,00");
    }
    lines.push(`*Total: R$ ${brl(Number(draft.grandTotal) || 0)}*`);
    lines.push(`Pagamento: ${paymentLabel(draft.paymentMethod)}`);
    if (draft.paymentMethod === "cash" && draft.changeFor != null) {
        lines.push(`Troco para: R$ ${brl(Number(draft.changeFor))}`);
    }
    lines.push(`Endereco: ${addressLine(draft)}`);
    lines.push("");
    lines.push("Revise e escolha uma opcao:");

    return lines.join("\n");
}

/** Lista numerada para clarificação de produto (body dos botões). */
export function formatSearchPicksClarificationBody(
    picks: Array<{ embalagemId: string; label: string; price?: number | null }>
): string {
    const top = picks.slice(0, 3);
    const lines = ["Qual opcao voce quer?", ""];
    top.forEach((p, i) => {
        const label = String(p.label ?? `Opcao ${i + 1}`).replaceAll(/\s+/g, " ").trim();
        const price =
            p.price != null && Number.isFinite(Number(p.price))
                ? ` — R$ ${brl(Number(p.price))}`
                : "";
        lines.push(`${i + 1}) ${label}${price}`);
    });
    lines.push("");
    lines.push("Toque no botao ou responda com o numero (ex.: 2).");
    return lines.join("\n");
}
