import { FOOTER_COLUMNS } from "@/lib/marketing/copy";
import { accountHref } from "@/lib/marketing/hosts";

type MarketingFooterProps = {
    linkToApp?: boolean;
};

export function MarketingFooter({ linkToApp = false }: MarketingFooterProps) {
    const loginHref = accountHref("/login", linkToApp);
    const signupHref = accountHref("/signup?plano=pro&periodo=year", linkToApp);

    return (
        <footer className="border-t border-slate-200/80 bg-white">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]">
                <a href={linkToApp ? "/" : "/inicio"} className="flex h-fit items-center gap-2.5">
                    <img
                        src="/brand/icone-512-transparente.svg?v=z1"
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 shrink-0"
                    />
                    <span className="font-[family-name:var(--font-landing-display)] text-lg font-extrabold tracking-tight text-slate-950">
                        Zampell
                    </span>
                </a>
                {FOOTER_COLUMNS.map((column) => (
                    <nav key={column.title} aria-label={column.title}>
                        <p className="text-sm font-semibold text-slate-950">{column.title}</p>
                        <ul className="mt-3 space-y-2">
                            {column.links.map((link) => (
                                <li key={link.label}>
                                    <a
                                        href={link.href}
                                        className="text-sm text-slate-600 transition-colors duration-200 hover:text-slate-950"
                                    >
                                        {link.label}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                ))}
                <nav aria-label="Conta">
                    <p className="text-sm font-semibold text-slate-950">Conta</p>
                    <ul className="mt-3 space-y-2">
                        <li>
                            <a href={loginHref} className="text-sm text-slate-600 transition-colors duration-200 hover:text-slate-950">
                                Entrar
                            </a>
                        </li>
                        <li>
                            <a href={signupHref} className="text-sm text-slate-600 transition-colors duration-200 hover:text-slate-950">
                                Começar no Pro anual
                            </a>
                        </li>
                    </ul>
                </nav>
            </div>
            <div className="border-t border-slate-200/80 px-4 py-6 text-center text-sm text-slate-500">
                © {new Date().getFullYear()} Zampell · Todos os direitos reservados
            </div>
        </footer>
    );
}
