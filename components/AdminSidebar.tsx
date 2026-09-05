"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun, X } from "lucide-react";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";
import { cn } from "@/lib/utils";
import {
  filterAdminNavCatalog,
  isAdminNavLeafActive,
  type AdminNavEntry,
  type AdminNavLeaf,
  type AdminNavSection,
} from "@/components/admin/adminNavCatalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function linkClass(active: boolean, collapsed: boolean, nested?: boolean) {
  return cn(
    "group relative flex items-center rounded-lg text-xs font-medium transition-all duration-150",
    collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2",
    nested && !collapsed && "py-1.5",
    active
      ? "bg-white/15 text-white shadow-sm"
      : "text-white/70 hover:bg-white/[0.08] hover:text-white"
  );
}

function iconWrapClass(active: boolean, nested?: boolean) {
  return cn(
    "flex shrink-0 items-center justify-center rounded-md transition-colors",
    nested ? "h-6 w-6" : "h-7 w-7",
    active
      ? "bg-white/20 text-white"
      : "bg-white/5 text-white/60 group-hover:bg-white/10 group-hover:text-white"
  );
}

function NavLeafLink({
  item,
  pathname,
  searchTab,
  collapsed,
  nested,
}: Readonly<{
  item: AdminNavLeaf;
  pathname: string | null;
  searchTab: string | null;
  collapsed: boolean;
  nested?: boolean;
}>) {
  const Icon = item.icon;
  const active = isAdminNavLeafActive(pathname, searchTab, item);

  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={linkClass(active, collapsed, nested)}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(87,255,143,0.8)]" />
      )}
      <div className={iconWrapClass(active, nested)}>
        <Icon className={cn(nested ? "h-3 w-3" : "h-3.5 w-3.5")} />
      </div>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function CollapsedSectionFlyout({
  section,
  pathname,
  searchTab,
}: Readonly<{
  section: AdminNavSection;
  pathname: string | null;
  searchTab: string | null;
}>) {
  const Icon = section.icon;
  const sectionActive = section.children.some((c) =>
    isAdminNavLeafActive(pathname, searchTab, c)
  );

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={section.label}
              className={cn(
                "group relative flex w-full items-center justify-center rounded-lg py-2.5 transition-all duration-150",
                sectionActive
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/70 hover:bg-white/[0.08] hover:text-white"
              )}
            >
              {sectionActive && (
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(87,255,143,0.8)]" />
              )}
              <div className={iconWrapClass(sectionActive)}>
                <Icon className="h-3.5 w-3.5" />
              </div>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{section.label}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent side="right" align="start" sideOffset={10} className="min-w-[12rem]">
        <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {section.children.map((child) => {
          const ChildIcon = child.icon;
          const active = isAdminNavLeafActive(pathname, searchTab, child);
          return (
            <DropdownMenuItem key={child.id} asChild>
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex cursor-pointer items-center gap-2",
                  active && "bg-primary/10 font-semibold"
                )}
              >
                <ChildIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span>{child.label}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ExpandedSection({
  section,
  pathname,
  searchTab,
}: Readonly<{
  section: AdminNavSection;
  pathname: string | null;
  searchTab: string | null;
}>) {
  return (
    <div className="space-y-0.5 pt-2">
      <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
        {section.label}
      </div>
      {section.children.map((child) => (
        <NavLeafLink
          key={child.id}
          item={child}
          pathname={pathname}
          searchTab={searchTab}
          collapsed={false}
          nested
        />
      ))}
    </div>
  );
}

function renderEntry(
  entry: AdminNavEntry,
  pathname: string | null,
  searchTab: string | null,
  collapsed: boolean
) {
  if (entry.kind === "link") {
    return (
      <NavLeafLink
        key={entry.id}
        item={entry}
        pathname={pathname}
        searchTab={searchTab}
        collapsed={collapsed}
      />
    );
  }
  if (collapsed) {
    return (
      <CollapsedSectionFlyout
        key={entry.id}
        section={entry}
        pathname={pathname}
        searchTab={searchTab}
      />
    );
  }
  return (
    <ExpandedSection
      key={entry.id}
      section={entry}
      pathname={pathname}
      searchTab={searchTab}
    />
  );
}

export default function AdminSidebar({
  isOpen,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchTab = searchParams.get("tab");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { loading: featuresLoading, features } = usePlanFeatures();

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleNav = useMemo(
    () => filterAdminNavCatalog(featuresLoading, features),
    [featuresLoading, features]
  );

  const isDark = theme === "dark";

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex flex-col overflow-hidden bg-primary text-zinc-50",
          "transition-all duration-300 ease-in-out",
          "fixed inset-y-0 left-0 z-50 h-full",
          isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          "lg:static lg:inset-auto lg:z-auto lg:h-full lg:translate-x-0 lg:shadow-none",
          collapsed ? "w-16" : "w-64 lg:w-60"
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-center border-b border-white/10 py-4",
            collapsed ? "justify-center px-0" : "gap-3 px-5"
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center">
            <img
              src="/brand/renthus-mark-on-dark.svg?v=mark9"
              alt={collapsed ? "RenthusAgent" : ""}
              width={36}
              height={36}
              className="h-9 w-9 object-contain object-center drop-shadow-[0_0_12px_rgba(87,255,143,0.45)]"
            />
          </span>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold tracking-wide">RenthusAgent</div>
              <div className="text-[10px] font-medium text-white/50">Painel Administrativo</div>
            </div>
          )}

          {!collapsed && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar menu"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-hide px-2 py-3">
          {visibleNav.map((entry) => renderEntry(entry, pathname, searchTab, collapsed))}
        </nav>

        <div className="shrink-0 space-y-1 border-t border-white/10 px-2 py-3">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setTheme(isDark ? "light" : "dark")}
                  aria-label="Alternar tema"
                  className="flex w-full items-center justify-center rounded-lg py-2.5 text-white/70 hover:bg-white/[0.08] hover:text-white"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                    {mounted ? (
                      isDark ? (
                        <Sun className="h-3.5 w-3.5 text-yellow-300" />
                      ) : (
                        <Moon className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {mounted && isDark ? "Modo claro" : "Modo escuro"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              aria-label="Alternar tema"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-white/70 hover:bg-white/[0.08] hover:text-white"
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
                {mounted ? (
                  isDark ? (
                    <Sun className="h-3.5 w-3.5 text-yellow-300" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )
                ) : (
                  <span className="h-3.5 w-3.5" />
                )}
              </div>
              <span>{mounted && isDark ? "Modo Claro" : "Modo Escuro"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "hidden w-full items-center rounded-lg py-2.5 text-xs font-medium text-white/70 hover:bg-white/[0.08] hover:text-white lg:flex",
              collapsed ? "justify-center px-0" : "gap-3 px-3"
            )}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronLeft className="h-3.5 w-3.5" />
              )}
            </div>
            {!collapsed && <span>Recolher</span>}
          </button>

          {!collapsed && (
            <div className="rounded-xl bg-white/5 px-3 py-2.5">
              <p className="text-[11px] font-semibold text-white">Dica rápida</p>
              <p className="mt-1 text-[10px] leading-relaxed text-white/50">
                Pressione{" "}
                <kbd className="rounded bg-white/10 px-1 font-semibold text-accent">Ctrl</kbd>+
                <kbd className="rounded bg-white/10 px-1 font-semibold text-accent">K</kbd> para
                abrir o menu de comandos.
              </p>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
