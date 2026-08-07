/**
 * Regra pura (sem I/O) para decidir quais endereços salvos oferecer na confirmação
 * de entrega: o mais usado historicamente vs o do pedido mais recente.
 *
 * Fonte dos dados: `rankCustomerAddressesByDelivery` (agrega `orders` por endereço).
 */
import type {
    AddressDeliveryStat,
    SavedClienteEnderecoRow,
} from "@/src/pro/tools/resolveSavedAddress";

export type AddressConfirmationCandidates = {
    /** Endereço com mais entregas (empate → principal, senão mais recente). Null sem cadastro. */
    primary: SavedClienteEnderecoRow | null;
    /** Endereço do pedido mais recente — só populado quando difere do `primary`. */
    secondary: SavedClienteEnderecoRow | null;
};

function isPrincipal(stat: AddressDeliveryStat): boolean {
    return stat.address.is_principal === true;
}

/**
 * `primary`: maior `deliveryCount`; empate → `is_principal`; empate → `lastDeliveredAt` mais recente.
 * `secondary`: endereço do pedido mais recente (`lastDeliveredAt` máximo entre todos), só se
 * for estruturalmente diferente do `primary` — evita botão duplicado quando é o mesmo endereço.
 */
export function resolveAddressConfirmationCandidates(
    stats: AddressDeliveryStat[]
): AddressConfirmationCandidates {
    if (!stats.length) return { primary: null, secondary: null };
    if (stats.length === 1) return { primary: stats[0]!.address, secondary: null };

    const ranked = [...stats].sort((a, b) => {
        if (b.deliveryCount !== a.deliveryCount) return b.deliveryCount - a.deliveryCount;
        if (isPrincipal(a) !== isPrincipal(b)) return isPrincipal(a) ? -1 : 1;
        return (b.lastDeliveredAt ?? "").localeCompare(a.lastDeliveredAt ?? "");
    });
    const primary = ranked[0]!.address;

    const mostRecent = stats
        .filter((s) => s.lastDeliveredAt)
        .sort((a, b) => String(b.lastDeliveredAt).localeCompare(String(a.lastDeliveredAt)))[0];
    const secondary =
        mostRecent && mostRecent.address.id !== primary.id ? mostRecent.address : null;

    return { primary, secondary };
}
