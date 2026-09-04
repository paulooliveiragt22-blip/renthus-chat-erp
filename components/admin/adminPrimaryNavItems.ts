import {
    Clock,
    MessageCircle,
    Receipt,
    ShoppingCart,
    type LucideIcon,
} from "lucide-react";

/** Fonte única dos atalhos primários do painel admin (header desktop + dock mobile). */
export type AdminPrimaryNavItem = {
    href: string;
    label: string;
    shortLabel?: string;
    icon: LucideIcon;
};

export const ADMIN_PRIMARY_NAV: ReadonlyArray<AdminPrimaryNavItem> = [
    { href: "/whatsapp", label: "Chat", icon: MessageCircle },
    { href: "/pedidos", label: "Pedidos", icon: Receipt },
    { href: "/fila", label: "Fila de pedidos", shortLabel: "Fila", icon: Clock },
    { href: "/pdv", label: "PDV", icon: ShoppingCart },
];

export function isAdminPrimaryNavActive(
    pathname: string | null,
    href: string
): boolean {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
}
