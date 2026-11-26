"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { attendanceTalkHref } from "@/lib/marketing/attendanceOffer";
import { accountHref, attendanceLandingHref, deliveryLandingHref } from "@/lib/marketing/hosts";

type MarketingProduct = "delivery" | "attendance";

type MarketingHeaderProps = {
    linkToApp?: boolean;
    product?: MarketingProduct;
};

const SECTION_LINKS = [
    { href: "#produto", label: "Produto" },
    { href: "#planos", label: "Planos" },
    { href: "#faq", label: "Dúvidas" },
] as const;

export function MarketingHeader({ linkToApp = false, product = "delivery" }: MarketingHeaderProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const loginHref = accountHref("/login", linkToApp);
    const deliveryHref = deliveryLandingHref(linkToApp);
    const attendanceHref = attendanceLandingHref(linkToApp);
    const primaryHref = product === "attendance" ? attendanceTalkHref("year") : accountHref("/signup?plano=pro&periodo=year", linkToApp);
    const primaryLabel = product === "attendance" ? "Começar no anual" : "Começar no Pro";
    const logoHref = product === "attendance" ? attendanceHref : deliveryHref;

    return (
        <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/80 text-slate-950 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                <a href={logoHref} className="flex min-w-0 items-center gap-2.5">
                    <img
                        src="/brand/icone-512-transparente.svg?v=z1"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0"
                    />
                    <span className="truncate font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight">
                        Zampell
                    </span>
                </a>
                <nav aria-label="Principal" className="hidden shrink-0 items-center gap-1 md:flex lg:gap-2">
                    {SECTION_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100"
                        >
                            {link.label}
                        </a>
                    ))}
                    <a
                        href={loginHref}
                        className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100"
                    >
                        Entrar
                    </a>
                    <a
                        href={primaryHref}
                        className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500"
                    >
                        {primaryLabel}
                    </a>
                </nav>
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-950 transition-colors duration-200 hover:bg-slate-100 md:hidden"
                            aria-label="Abrir menu"
                        >
                            <Menu className="size-5" aria-hidden />
                        </button>
                    </SheetTrigger>
                    <SheetContent
                        side="right"
                        className="flex w-[min(100%,20rem)] flex-col bg-white p-6 text-slate-950"
                    >
                        <SheetTitle className="pr-8 font-[family-name:var(--font-landing-display)] text-lg font-extrabold text-slate-950">
                            Menu
                        </SheetTitle>
                        <nav aria-label="Principal" className="mt-6 flex flex-col gap-1">
                            {SECTION_LINKS.map((link) => (
                                <a
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setMenuOpen(false)}
                                    className="rounded-xl px-3 py-3 text-base font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-100"
                                >
                                    {link.label}
                                </a>
                            ))}
                            <a
                                href={loginHref}
                                onClick={() => setMenuOpen(false)}
                                className="rounded-xl px-3 py-3 text-base font-semibold text-slate-800 transition-colors duration-200 hover:bg-slate-100"
                            >
                                Entrar
                            </a>
                            <a
                                href={primaryHref}
                                onClick={() => setMenuOpen(false)}
                                className="mt-3 inline-flex items-center justify-center rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-colors duration-200 hover:bg-emerald-500"
                            >
                                {primaryLabel}
                            </a>
                        </nav>
                    </SheetContent>
                </Sheet>
            </div>
        </header>
    );
}
