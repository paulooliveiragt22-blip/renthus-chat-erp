/** Catálogo imutável de capabilities (RBAC). Keys versionadas no código; UI só lista. */

export const CAPABILITY_KEYS = [
    "pdv.access",
    "orders.read",
    "orders.write",
    "orders.status",
    "kitchen.view",
    "delivery.view",
    "mesa.access",
    "products.read",
    "products.write",
    "customers.read",
    "customers.write",
    "estoque.write",
    "financeiro.read",
    "financeiro.write",
    "whatsapp.operate",
    "print.operate",
    "dashboard.view",
    "menu.manage",
    "settings.company",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export type CapabilityGroup = {
    id: string;
    label: string;
    keys: CapabilityKey[];
};

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
    {
        id: "vendas",
        label: "Vendas e PDV",
        keys: ["pdv.access", "orders.read", "orders.write", "orders.status"],
    },
    {
        id: "operacao",
        label: "Operação",
        keys: ["kitchen.view", "delivery.view", "mesa.access", "print.operate"],
    },
    {
        id: "cadastros",
        label: "Cadastros",
        keys: [
            "products.read",
            "products.write",
            "customers.read",
            "customers.write",
            "estoque.write",
        ],
    },
    {
        id: "gestao",
        label: "Gestão",
        keys: [
            "financeiro.read",
            "financeiro.write",
            "dashboard.view",
            "whatsapp.operate",
            "menu.manage",
            "settings.company",
        ],
    },
];

const LABELS: Record<CapabilityKey, string> = {
    "pdv.access": "Acessar PDV e finalizar vendas",
    "orders.read": "Ver pedidos",
    "orders.write": "Criar e editar pedidos",
    "orders.status": "Alterar status de pedidos",
    "kitchen.view": "Visão de cozinha / fila",
    "delivery.view": "Entregas e motoboys",
    "mesa.access": "Mesas e comandas",
    "products.read": "Ver produtos",
    "products.write": "Cadastrar e editar produtos",
    "customers.read": "Ver clientes",
    "customers.write": "Cadastrar e editar clientes",
    "estoque.write": "Ajustar estoque",
    "financeiro.read": "Ver financeiro",
    "financeiro.write": "Lançar e alterar financeiro",
    "whatsapp.operate": "Operar WhatsApp / inbox",
    "print.operate": "Impressão e fila de jobs",
    "dashboard.view": "Ver dashboard",
    "menu.manage": "Cardápio digital",
    "settings.company": "Ver dados da empresa (leitura)",
};

export function capabilityLabel(key: CapabilityKey): string {
    return LABELS[key];
}

export function isCapabilityKey(v: unknown): v is CapabilityKey {
    return typeof v === "string" && (CAPABILITY_KEYS as readonly string[]).includes(v);
}

export function normalizeCapabilities(input: unknown): CapabilityKey[] {
    if (!Array.isArray(input)) return [];
    const out: CapabilityKey[] = [];
    const seen = new Set<string>();
    for (const item of input) {
        if (!isCapabilityKey(item) || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
    }
    return out;
}

export function hasCapability(
    granted: readonly string[] | null | undefined,
    required: CapabilityKey | CapabilityKey[],
    mode: "any" | "all" = "any"
): boolean {
    const set = new Set((granted ?? []).map((k) => String(k)));
    const need = Array.isArray(required) ? required : [required];
    if (need.length === 0) return true;
    if (mode === "all") return need.every((k) => set.has(k));
    return need.some((k) => set.has(k));
}
