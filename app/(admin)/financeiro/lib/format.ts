import { ORIGIN_LABELS, normalizeFinanceOrigin } from "@/src/financeiro/domain/origin";

export function brl(v: number) {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function pct(v: number) {
    return v.toFixed(1) + "%";
}

export function pad(n: number) {
    return String(n).padStart(2, "0");
}

export function isoDate(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const PAY_META: Record<string, { label: string; color: string }> = {
    pix: { label: "PIX", color: "#22c55e" },
    card: { label: "Cartão", color: "#6d28d9" },
    cash: { label: "Dinheiro", color: "#f97316" },
    debit: { label: "Débito", color: "#3b82f6" },
    credit_installment: { label: "Crédito Parc.", color: "#a855f7" },
    boleto: { label: "Boleto", color: "#0ea5e9" },
    promissoria: { label: "Promissória", color: "#f59e0b" },
    cheque: { label: "Cheque", color: "#64748b" },
};

export function originLabel(raw: string | null | undefined): string {
    return ORIGIN_LABELS[normalizeFinanceOrigin(raw)];
}

export const EXPENSE_CATS = [
    "Fornecedor de Bebidas",
    "Aluguel",
    "Energia/Água",
    "Salários",
    "Marketing",
    "Outros",
];
