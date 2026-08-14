import type { OrderDraft } from "@/src/types/contracts";
import type { PublicMenuCartLine } from "@/src/types/contracts.public-menu";

/** Snapshot do rascunho do bot → linhas do carrinho do cardápio web. */
export function mapDraftToMenuCart(draft: OrderDraft): PublicMenuCartLine[] {
    const lines: PublicMenuCartLine[] = [];
    for (const item of draft.items) {
        const embalagemId = String(item.produtoEmbalagemId ?? "").trim();
        const qty = Number(item.quantity);
        if (!embalagemId || !Number.isFinite(qty) || qty <= 0) continue;
        lines.push({
            embalagemId,
            productId: String(item.productVolumeId ?? "").trim() || embalagemId,
            name: String(item.productName ?? "").trim() || "Item",
            sigla: "",
            fatorConversao: Number.isFinite(item.fatorConversao) ? item.fatorConversao : 1,
            unitPrice: Number.isFinite(item.unitPrice) ? item.unitPrice : 0,
            qty: Math.floor(qty),
        });
    }
    return lines;
}
