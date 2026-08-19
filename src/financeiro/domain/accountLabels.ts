/** Labels de negócio para contas do ledger (extrato / estorno). */

export const ACCOUNT_BUSINESS_LABELS: Record<string, string> = {
    "1.1": "Caixa",
    "1.2": "Contas a receber",
    "2.1": "Contas a pagar",
    "3.1": "Itens (receita de produtos)",
    "3.2": "Taxa de entrega",
    "3.3": "Taxas de serviço",
    "4.2": "Despesas operacionais",
    "5.1": "Ajustes de caixa",
};

export function accountBusinessLabel(code: string, fallbackName?: string): string {
    const c = String(code ?? "").trim();
    return ACCOUNT_BUSINESS_LABELS[c] ?? fallbackName ?? c;
}
