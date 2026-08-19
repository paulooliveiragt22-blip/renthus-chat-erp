export type FinanceTab = "dashboard" | "extrato" | "receber" | "pagar" | "caixa" | "dre";

export type DateRange = { from: string; to: string; days: number };

export type Bill = {
    id: string;
    type: "receivable" | "payable";
    description: string | null;
    customer_name: string | null;
    original_amount: number;
    saldo_devedor: number;
    due_date: string;
    status: "open" | "partial" | "paid" | "overdue" | "canceled";
    payment_method: string | null;
    sale_id: string | null;
    order_id: string | null;
};

export type ExtratoLine = {
    id: string;
    date: string;
    type: "income" | "expense";
    source: "order" | "financial_entry" | "expense" | "journal";
    description: string;
    customer: string;
    channel: string;
    payment_method: string;
    amount: number;
    status: string;
    orderId?: string | null;
    saleId?: string | null;
    customerId?: string | null;
    orderStatus?: string | null;
    journalId?: string | null;
    journalSourceType?: string | null;
    journalStatus?: string | null;
};

export type DaySummary = {
    isoDate: string;
    label: string;
    revenue: number;
    cost: number;
    orders: number;
    expensesDay: number;
};

export type PaySummary = {
    method: string;
    label: string;
    color: string;
    total: number;
    count: number;
};

export type ExpenseRow = {
    id: string;
    category: string;
    description: string;
    amount: number;
    due_date: string;
    payment_status: string;
};

export type Stats = {
    revenue: number;
    cost: number;
    expensesPaid: number;
    profit: number;
    realProfit: number;
    orders: number;
    ticket: number;
    byDay: DaySummary[];
    byPay: PaySummary[];
    byOrigin: Record<string, number>;
    totalAReceber: number;
};

export type AgingSummary = {
    totalOpen: number;
    current: number;
    overdue0To30: number;
    overdue31To60: number;
    overdue61To90: number;
    overdue90Plus: number;
};

export type CaixaReg = {
    id: string;
    opened_at: string;
    closed_at: string | null;
    operator_name: string | null;
    initial_amount: number;
    closing_amount: number | null;
    expected_balance: number | null;
    difference: number | null;
    status: string;
};

export type CaixaMov = {
    id: string;
    type: string;
    amount: number;
    reason: string | null;
    operator_name: string | null;
    occurred_at: string;
};

export type DreLine = { account_name: string; account_type: string; total: number };
