"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    ADMIN_PRIMARY_NAV,
    isAdminPrimaryNavActive,
} from "@/components/admin/adminPrimaryNavItems";
import { cn } from "@/lib/utils";

type AdminPrimaryNavVariant = "desktop" | "dock";

type AdminPrimaryNavProps = {
    variant: AdminPrimaryNavVariant;
    className?: string;
    /** Dock mobile: false oculta barra (teclado / foco em campo). Default true. */
    dockVisible?: boolean;
};

/**
 * Atalhos primários do admin.
 * - `desktop`: centro do header (`lg+`)
 * - `dock`: barra flutuante inferior (`< lg`), montada pelo AdminShell
 */
export default function AdminPrimaryNav({
    variant,
    className,
    dockVisible = true,
}: AdminPrimaryNavProps) {
    const pathname = usePathname();

    if (variant === "desktop") {
        return (
            <nav
                aria-label="Atalhos principais"
                className={cn(
                    "hidden items-center justify-center gap-2 justify-self-center sm:gap-3 lg:flex",
                    className
                )}
            >
                {ADMIN_PRIMARY_NAV.map(({ href, label, icon: Icon }) => {
                    const active = isAdminPrimaryNavActive(pathname, href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            title={label}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                                "transition-transform duration-150 ease-out will-change-transform",
                                "hover:-translate-y-0.5 hover:scale-[1.03]",
                                "active:translate-y-0 active:scale-100",
                                active
                                    ? "bg-accent text-accent-foreground shadow-sm"
                                    : "bg-[#16364D] text-white hover:brightness-110"
                            )}
                        >
                            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>{label}</span>
                        </Link>
                    );
                })}
            </nav>
        );
    }

    return (
        <nav
            aria-label="Atalhos principais"
            aria-hidden={!dockVisible}
            className={cn(
                "pointer-events-none fixed inset-x-0 bottom-0 z-50 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden",
                "transition-[transform,opacity] duration-200 ease-out",
                dockVisible
                    ? "translate-y-0 opacity-100"
                    : "translate-y-full opacity-0",
                className
            )}
        >
            <div
                className={cn(
                    "pointer-events-auto mx-auto flex max-w-md items-stretch justify-between gap-1 rounded-2xl border border-white/10 bg-[#11283B]/95 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md sm:max-w-lg sm:gap-1.5 sm:p-2",
                    !dockVisible && "pointer-events-none"
                )}
            >
                {ADMIN_PRIMARY_NAV.map(({ href, label, shortLabel, icon: Icon }) => {
                    const active = isAdminPrimaryNavActive(pathname, href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            title={label}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold sm:text-[11px]",
                                "transition-transform duration-150 ease-out",
                                "active:scale-95",
                                active
                                    ? "bg-accent text-accent-foreground shadow-sm"
                                    : "bg-[#16364D] text-white hover:brightness-110"
                            )}
                        >
                            <Icon
                                className="h-4 w-4 shrink-0 sm:h-[18px] sm:w-[18px]"
                                aria-hidden
                            />
                            <span className="truncate">{shortLabel ?? label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
