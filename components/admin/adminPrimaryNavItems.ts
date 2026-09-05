import {
  getAdminPrimaryNavItems,
  isAdminNavLeafActive,
  type AdminNavLeaf,
} from "@/components/admin/adminNavCatalog";
import type { LucideIcon } from "lucide-react";

/** Fonte única dos atalhos primários (header desktop + dock mobile). */
export type AdminPrimaryNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
};

/** Fail-open: sem features ainda, lista completa dos primários. */
export const ADMIN_PRIMARY_NAV: ReadonlyArray<AdminPrimaryNavItem> =
  getAdminPrimaryNavItems(true, new Set()).map((leaf) => ({
    href: leaf.href,
    label: leaf.shortLabel ?? leaf.label,
    shortLabel: leaf.shortLabel,
    icon: leaf.icon,
  }));

export function isAdminPrimaryNavActive(
  pathname: string | null,
  href: string
): boolean {
  return isAdminNavLeafActive(pathname, null, { href });
}

export function mapLeafToPrimary(leaf: AdminNavLeaf): AdminPrimaryNavItem {
  return {
    href: leaf.href,
    label: leaf.shortLabel ?? leaf.label,
    shortLabel: leaf.shortLabel,
    icon: leaf.icon,
  };
}
