"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Search,
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function groupHeading(id: CommandGroupId): string {
  return COMMAND_GROUP_LABELS[id];
}

function itemIcon(item: CommandNavItem): LucideIcon {
  if (item.group === "billing") return CreditCard;
  if (item.group === "clientes") return Search;
  return ArrowRight;
}

export function CommandMenu({ open, onOpenChange }: Props) {
  const router = useRouter();
  const { companies, currentCompanyId, reload } = useWorkspace();
  const { loading: featuresLoading, features } = usePlanFeatures();
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);

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
    if (!open) setQuery("");
  }, [open]);

  const go = useCallback(
    (href: string) => {
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

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} label="Menu de comandos">
      <CommandInput
        placeholder="Ir para… (ex.: PDV, clientes, plano)"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Nenhum resultado.</CommandEmpty>

        {searchClientHref ? (
          <CommandGroup heading={groupHeading("clientes")}>
            <CommandItem
              value={`buscar-clientes ${query}`}
              keywords={["cliente", "buscar", "pesquisa"]}
              onSelect={() => go(searchClientHref)}
            >
              <Search className="h-4 w-4 shrink-0 text-foreground-muted" aria-hidden />
              <span className="truncate">
                Buscar «{query.trim()}» em clientes
              </span>
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
                    onSelect={() => go(href)}
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
