"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Bike,
  Building2,
  Clock,
  CreditCard,
  FileText,
  Headphones,
  History,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  Printer,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";
import { normalizeCompanyRole, type CompanyRole } from "@/lib/workspace/staffRoles";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  COMMAND_GROUP_LABELS,
  clientesSearchHref,
  filterCommandNavItems,
  type CommandGroupId,
  type CommandNavItem,
} from "@/components/command/commandItems";
import {
  loadCommandRecents,
  pushCommandRecent,
  type CommandRecentEntry,
} from "@/components/command/commandRecents";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const NAV_ICONS: Record<string, LucideIcon> = {
  "nav-dashboard": LayoutDashboard,
  "nav-pedidos": Receipt,
  "nav-fila": Clock,
  "nav-pdv": ShoppingCart,
  "nav-mesa": UtensilsCrossed,
  "nav-whatsapp": MessageCircle,
  "nav-templates": FileText,
  "nav-campanhas": Megaphone,
  "nav-produtos": ShoppingBag,
  "nav-clientes": Users,
  "nav-entregadores": Bike,
  "nav-estoque": Package,
  "nav-financeiro": Wallet,
  "nav-relatorios": BarChart3,
  "nav-impressoras": Printer,
  "nav-suporte": Headphones,
  "nav-config": Settings,
  "clientes-buscar": Search,
  "billing-plano": CreditCard,
};

function groupHeading(id: CommandGroupId | "recentes"): string {
  if (id === "recentes") return "Recentes";
  return COMMAND_GROUP_LABELS[id];
}

function itemIcon(item: CommandNavItem): LucideIcon {
  return NAV_ICONS[item.id] ?? Search;
}

export function CommandMenu({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { companies, currentCompanyId, reload } = useWorkspace();
  const { loading: featuresLoading, features } = usePlanFeatures();
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);
  const [recents, setRecents] = useState<CommandRecentEntry[]>([]);

  const role: CompanyRole | null = useMemo(() => {
    const raw = companies.find((c) => c.id === currentCompanyId)?.role;
    return normalizeCompanyRole(raw) ?? null;
  }, [companies, currentCompanyId]);

  const navItems = useMemo(
    () =>
      filterCommandNavItems({
        role,
        featuresLoading,
        features,
      }),
    [role, featuresLoading, features]
  );

  const byGroup = useMemo(() => {
    const map = new Map<CommandGroupId, CommandNavItem[]>();
    for (const item of navItems) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return map;
  }, [navItems]);

  const otherWorkspaces = useMemo(
    () => companies.filter((c) => c.id !== currentCompanyId),
    [companies, currentCompanyId]
  );

  const searchClientHref = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return null;
    return clientesSearchHref(q);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setRecents(loadCommandRecents());
  }, [open]);

  const go = useCallback(
    (href: string, meta?: { id: string; label: string }) => {
      if (meta) {
        setRecents(pushCommandRecent({ id: meta.id, label: meta.label, href }));
      }
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router]
  );

  const switchWorkspace = useCallback(
    async (companyId: string) => {
      if (!companyId || companyId === currentCompanyId || switching) return;
      setSwitching(true);
      try {
        const res = await fetch("/api/workspace/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ company_id: companyId }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(err?.error ?? "Falha ao trocar workspace");
          return;
        }
        try {
          await reload();
        } catch (e) {
          console.warn("reload workspace after command select failed", e);
        }
        try {
          router.refresh();
        } catch {
          /* ignore */
        }
        const name = companies.find((c) => c.id === companyId)?.name;
        toast.success(name ? `Empresa: ${name}` : "Workspace atualizado");
        onOpenChange(false);
      } finally {
        setSwitching(false);
      }
    },
    [companies, currentCompanyId, onOpenChange, reload, router, switching]
  );

  const showRecents = !query.trim() && recents.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label="Menu de comandos">
      <CommandInput
        placeholder="Ir para… (ex.: PDV, clientes, plano)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Nenhum resultado.</CommandEmpty>

        {showRecents ? (
          <CommandGroup heading={groupHeading("recentes")}>
            {recents.map((r) => {
              const Icon = NAV_ICONS[r.id] ?? History;
              return (
                <CommandItem
                  key={`recent-${r.id}`}
                  value={`recent ${r.label} ${r.href}`}
                  onSelect={() => go(r.href, { id: r.id, label: r.label })}
                >
                  <Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
                  <span className="truncate">{r.label}</span>
                  <CommandShortcut>recente</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {searchClientHref ? (
          <CommandGroup heading={groupHeading("clientes")}>
            <CommandItem
              value={`buscar-clientes ${query}`}
              keywords={["cliente", "buscar", "pesquisa"]}
              onSelect={() =>
                go(searchClientHref, {
                  id: "clientes-buscar",
                  label: `Buscar «${query.trim()}»`,
                })
              }
            >
              <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
              <span className="truncate">Buscar «{query.trim()}» em clientes</span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {(["navegacao", "clientes", "billing"] as const).map((groupId) => {
          const items = byGroup.get(groupId);
          if (!items?.length) return null;
          return (
            <CommandGroup key={groupId} heading={groupHeading(groupId)}>
              {items.map((item) => {
                const Icon = itemIcon(item);
                const href =
                  item.id === "clientes-buscar" && query.trim().length >= 2
                    ? clientesSearchHref(query)
                    : item.href;
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                    keywords={item.keywords}
                    onSelect={() => go(href, { id: item.id, label: item.label })}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {item.group === "billing" ? (
                      <CommandShortcut>só link</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}

        {otherWorkspaces.length > 0 ? (
          <CommandGroup heading={groupHeading("workspace")}>
            {otherWorkspaces.map((c) => (
              <CommandItem
                key={c.id}
                value={`workspace ${c.name}`}
                disabled={switching}
                onSelect={() => void switchWorkspace(c.id)}
              >
                <Building2 className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
                <span className="truncate">Trocar para {c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
