import { ATTENDANCE_FOOTER, officeCheckoutPath } from "@/lib/marketing/attendanceOffer";
import { FOOTER_COLUMNS } from "@/lib/marketing/copy";
import { accountHref, attendanceLandingHref, deliveryLandingHref } from "@/lib/marketing/hosts";

type MarketingFooterProps = {
    linkToApp?: boolean;
    product?: "delivery" | "attendance";
};

export function MarketingFooter({ linkToApp = false, product = "delivery" }: MarketingFooterProps) {
    const loginHref = accountHref("/login", linkToApp);
    const signupHref = accountHref("/signup?plano=pro&periodo=year", linkToApp);
    const homeHref = product === "attendance" ? attendanceLandingHref(linkToApp) : deliveryLandingHref(linkToApp);
    const otherHref = product === "attendance" ? deliveryLandingHref(linkToApp) : attendanceLandingHref(linkToApp);
    const otherLabel = product === "attendance" ? "Delivery" : "Office";
    const startHref = product === "attendance" ? accountHref(officeCheckoutPath("year"), linkToApp) : signupHref;
    const startLabel = product === "attendance" ? "Começar no anual" : "Começar no Pro anual";
    const columns = product === "attendance" ? ATTENDANCE_FOOTER : FOOTER_COLUMNS;

    return (
        <footer className="border-t border-slate-200/80 bg-white">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
                <a href={homeHref} className="flex h-fit items-center gap-2.5">
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
                {columns.map((column) => (
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
                            <a href={startHref} className="text-sm text-slate-600 transition-colors duration-200 hover:text-slate-950">
                                {startLabel}
                            </a>
                        </li>
                        <li>
                            <a href={otherHref} className="text-sm text-slate-600 transition-colors duration-200 hover:text-slate-950">
                                {otherLabel}
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
