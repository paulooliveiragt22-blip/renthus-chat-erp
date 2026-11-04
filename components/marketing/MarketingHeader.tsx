import { accountHref } from "@/lib/marketing/hosts";

type MarketingHeaderProps = {
    linkToApp?: boolean;
};

export function MarketingHeader({ linkToApp = false }: MarketingHeaderProps) {
    return (
        <header className="sticky top-0 z-40 border-b border-white/10 bg-[#16364D] text-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <a href={linkToApp ? "/" : "/inicio"} className="flex min-w-0 items-center gap-2.5">
                    <img
                        src="/brand/icone-512-transparente.svg?v=z1"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0"
                    />
                    <img
                        src="/brand/zampell-wordmark.svg?v=z1"
                        alt="Zampell"
                        width={148}
                        height={40}
                        className="h-8 w-auto"
                    />
                    <span className="hidden rounded-md bg-zinc-300 px-2 py-1 text-[0.7rem] font-bold tracking-wide text-[#16364D] uppercase sm:inline">
                        Delivery
                    </span>
                </a>
                <nav aria-label="Principal" className="flex shrink-0 items-center gap-2 sm:gap-3">
                    <a
                        href={accountHref("/login", linkToApp)}
                        className="rounded-full px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
                    >
                        Entrar
                    </a>
                    <a
                        href={linkToApp ? accountHref("/signup", true) : "#planos"}
                        className="rounded-full bg-[#57ff8f] px-3 py-2 text-sm font-bold text-[#16364D] hover:brightness-95 sm:px-4"
                    >
                        Começar
                    </a>
                </nav>
            </div>
        </header>
    );
}
