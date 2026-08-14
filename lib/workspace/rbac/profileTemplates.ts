import type { CapabilityKey } from "@/lib/workspace/rbac/capabilities";

export const PROFILE_TEMPLATE_KEYS = [
    "cashier",
    "kitchen",
    "driver",
    "waiter",
    "custom",
] as const;

export type ProfileTemplateKey = (typeof PROFILE_TEMPLATE_KEYS)[number];

export function isProfileTemplateKey(v: unknown): v is ProfileTemplateKey {
    return (
        typeof v === "string" &&
        (PROFILE_TEMPLATE_KEYS as readonly string[]).includes(v)
    );
}

export function templateLabel(key: ProfileTemplateKey): string {
    if (key === "cashier") return "Atendente / Caixa";
    if (key === "kitchen") return "Cozinha";
    if (key === "driver") return "Entregador";
    if (key === "waiter") return "Garçom / Garçonete";
    return "Outro";
}

/** Seeds padrão (editáveis depois pelo admin). `custom` não entra no seed automático. */
export const DEFAULT_PROFILE_SEEDS: ReadonlyArray<{
    template_key: Exclude<ProfileTemplateKey, "custom">;
    name: string;
    capabilities: CapabilityKey[];
}> = [
    {
        template_key: "cashier",
        name: "Atendente / Caixa",
        capabilities: [
            "pdv.access",
            "orders.read",
            "orders.write",
            "orders.status",
            "customers.read",
            "customers.write",
            "products.read",
            "print.operate",
            "dashboard.view",
            "whatsapp.operate",
        ],
    },
    {
        template_key: "kitchen",
        name: "Cozinha",
        capabilities: [
            "kitchen.view",
            "orders.read",
            "orders.status",
            "print.operate",
            "products.read",
        ],
    },
    {
        template_key: "driver",
        name: "Entregador",
        capabilities: [
            "delivery.view",
            "orders.read",
            "orders.status",
            "customers.read",
            "print.operate",
        ],
    },
    {
        template_key: "waiter",
        name: "Garçom / Garçonete",
        capabilities: [
            "mesa.access",
            "orders.read",
            "orders.write",
            "orders.status",
            "products.read",
            "customers.read",
            "print.operate",
        ],
    },
];
