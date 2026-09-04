/**
 * Oferta de endereço após o cliente escolher Entrega:
 * pergunta o último usado + lista numerada dos outros + botões Confirmar / Novo.
 */

import type { OutboundMessage } from "@/src/types/contracts";
import type { SavedClienteEnderecoRow } from "@/src/pro/tools/resolveSavedAddress";
import { buildAiAddressFromSavedClienteRow } from "@/src/pro/tools/resolveSavedAddress";
import type { AddressDeliveryStat } from "@/src/pro/tools/resolveSavedAddress";

export type PendingAddressPickOption = {
    id: string;
    label: string;
};

export function formatSavedAddressLine(row: SavedClienteEnderecoRow): string {
    const parsed = buildAiAddressFromSavedClienteRow(row);
    if (parsed) {
        const cityUf = [parsed.cidade, parsed.estado].filter(Boolean).join("/");
        const core = [parsed.logradouro, parsed.numero].filter(Boolean).join(", ");
        const mid = [parsed.bairro, cityUf].filter(Boolean).join(", ");
        const body = [core, mid].filter(Boolean).join(" — ");
        const apelido = parsed.apelido?.trim();
        return apelido ? `${apelido}: ${body}` : body;
    }
    const parts = [
        row.apelido?.trim(),
        [row.logradouro, row.numero].filter(Boolean).join(", "),
        row.bairro?.trim(),
        [row.cidade, row.estado].filter(Boolean).join("/"),
    ].filter(Boolean);
    return parts.join(" — ") || "Endereço";
}

/** Completos o bastante para checkout no WA (cidade + UF). */
export function listCompleteSavedAddresses(stats: AddressDeliveryStat[]): SavedClienteEnderecoRow[] {
    return stats
        .map((s) => s.address)
        .filter((a) => buildAiAddressFromSavedClienteRow(a) != null);
}

/**
 * Proposto = último usado em pedido entregue/finalizado; senão principal; senão o 1º completo.
 */
export function pickProposedDeliveryAddress(
    stats: AddressDeliveryStat[],
    complete: SavedClienteEnderecoRow[]
): SavedClienteEnderecoRow | null {
    if (!complete.length) return null;
    const completeIds = new Set(complete.map((a) => a.id));
    const withLast = stats
        .filter((s) => completeIds.has(s.address.id) && s.lastDeliveredAt)
        .sort((a, b) => String(b.lastDeliveredAt).localeCompare(String(a.lastDeliveredAt)));
    if (withLast[0]) return withLast[0].address;
    const principal = complete.find((a) => a.is_principal === true);
    return principal ?? complete[0]!;
}

export function buildPendingAddressPickOptions(
    rows: SavedClienteEnderecoRow[]
): PendingAddressPickOption[] {
    return rows.map((a) => ({
        id: a.id,
        label: formatSavedAddressLine(a),
    }));
}

/**
 * Texto canónico (PT-BR) + botões Confirmar / Novo.
 * `others` = cadastrados além do proposto (podem ser 0).
 */
export function buildDeliveryAddressOfferOutbound(params: {
    proposed: SavedClienteEnderecoRow;
    others: SavedClienteEnderecoRow[];
}): OutboundMessage[] {
    const proposedLine = formatSavedAddressLine(params.proposed);
    const lines: string[] = [`O endereço de entrega é ${proposedLine}?`];
    if (params.others.length > 0) {
        lines.push("", "Temos estes outros cadastrados:");
        for (let i = 0; i < params.others.length; i++) {
            lines.push(`${i + 1}. ${formatSavedAddressLine(params.others[i]!)}`);
        }
        lines.push(
            "",
            "Digite o número correspondente ou use os botões abaixo para confirmar ou adicionar novo."
        );
    } else {
        lines.push("", "Use os botões abaixo para confirmar ou adicionar novo.");
    }
    return [
        {
            kind: "buttons",
            text: lines.join("\n"),
            buttons: [
                { id: "pro_confirm_saved_address", title: "Confirmar" },
                { id: "pro_new_address_flow", title: "Novo" },
            ],
        },
    ];
}

/** Índice 1-based sobre a lista numerada (= `others`, não inclui o proposto). */
export function parseAddressOfferIndex(text: string, othersCount: number): number | null {
    if (othersCount < 1) return null;
    const m = String(text ?? "").trim().match(/^(\d{1,2})$/u);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > othersCount) return null;
    return n;
}
