"use client";

import { toast } from "sonner";
import type { AdminAlert } from "../domain/AdminAlert";

/**
 * Toast Sonner clicável (ADR-0009). Sem cores custom — tokens do Toaster.
 * Posição: bottom-right (components/ui/sonner.tsx).
 */
export function presentClickableSonnerAlert(
    alert: AdminAlert,
    navigate: (href: string) => void
): void {
    const go = () => navigate(alert.href);

    toast.custom(
        (id) => (
            <div
                role="alertdialog"
                aria-labelledby={`alert-title-${id}`}
                aria-describedby={`alert-desc-${id}`}
                className="flex w-full max-w-sm cursor-pointer flex-col gap-2 rounded-lg border border-border bg-background-card p-3 text-foreground shadow-lg dark:border-zinc-700"
                tabIndex={0}
                onClick={() => {
                    go();
                    toast.dismiss(id);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        go();
                        toast.dismiss(id);
                    }
                }}
            >
                <p
                    id={`alert-title-${id}`}
                    className="truncate text-sm font-semibold text-foreground"
                >
                    {alert.title}
                </p>
                <p
                    id={`alert-desc-${id}`}
                    className="line-clamp-2 text-xs text-foreground-muted"
                >
                    {alert.description}
                </p>
                <button
                    type="button"
                    className="mt-0.5 inline-flex w-fit rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={(e) => {
                        e.stopPropagation();
                        go();
                        toast.dismiss(id);
                    }}
                >
                    {alert.actionLabel}
                </button>
            </div>
        ),
        { duration: 10_000 }
    );
}
