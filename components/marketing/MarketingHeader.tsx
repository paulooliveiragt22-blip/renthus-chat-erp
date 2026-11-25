import { accountHref } from "@/lib/marketing/hosts";

type MarketingHeaderProps = {
    linkToApp?: boolean;
};

export function MarketingHeader({ linkToApp = false }: MarketingHeaderProps) {
    return (
        <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 text-slate-950 backdrop-blur-md">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <a href={linkToApp ? "/" : "/inicio"} className="flex min-w-0 items-center gap-2.5">
                    <img
                        src="/brand/icone-512-transparente.svg?v=z1"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0"
                    />
                    <span className="font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight">
                        Zampell
                    </span>
                    <span className="hidden rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.7rem] font-bold tracking-wide text-emerald-700 uppercase sm:inline">
                        Delivery
                    </span>
                </a>
                <nav aria-label="Principal" className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <a
                        href="#produto"
                        className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 md:inline-flex"
                    >
                        Produto
                    </a>
                    <a
                        href="#planos"
                        className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 md:inline-flex"
                    >
                        Planos
                    </a>
                    <a
                        href="#faq"
                        className="hidden rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100 md:inline-flex"
                    >
                        Dúvidas
                    </a>
                    <a
                        href={accountHref("/login", linkToApp)}
                        className="rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-100"
                    >
                        Entrar
                    </a>
                    <a
                        href={accountHref("/signup?plano=pro&periodo=year", linkToApp)}
                        className="rounded-full bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500 sm:px-4"
                    >
                        <span className="sm:hidden">Começar</span>
                        <span className="hidden sm:inline">Começar no Pro</span>
                    </a>
                </nav>
            </div>
        </header>
    );
}
