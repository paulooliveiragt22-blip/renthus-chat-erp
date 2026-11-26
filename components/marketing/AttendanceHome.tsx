import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { AttendancePlans } from "@/components/marketing/AttendancePlans";
import { Faq } from "@/components/marketing/Faq";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { OfficeFlowSimulator } from "@/components/marketing/OfficeFlowSimulator";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { ProductSwitch } from "@/components/marketing/ProductSwitch";
import { SiteChat } from "@/components/marketing/SiteChat";
import { StickySignupCta } from "@/components/marketing/StickySignupCta";
import {
    ATTENDANCE_FAQ,
    ATTENDANCE_HERO,
    ATTENDANCE_POINTS,
    officeCheckoutPath,
} from "@/lib/marketing/attendanceOffer";
import { accountHref, deliveryLandingHref } from "@/lib/marketing/hosts";

const inter = Inter({ subsets: ["latin"], variable: "--font-landing-body" });
const jakarta = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-landing-display",
});

type AttendanceHomeProps = {
    linkToApp?: boolean;
    siteChat?: {
        publicKey: string;
        companyName: string;
        replies: string[];
    } | null;
};

export function AttendanceHome({ linkToApp = false, siteChat = null }: AttendanceHomeProps) {
    const yearHref = accountHref(officeCheckoutPath("year"), linkToApp);

    return (
        <div
            className={`${inter.variable} ${jakarta.variable} min-h-screen scroll-smooth bg-white pb-28 font-[family-name:var(--font-landing-body)] text-slate-950 md:pb-0`}
        >
            <MarketingHeader linkToApp={linkToApp} product="attendance" />
            <main>
                <section className="relative overflow-hidden bg-white pt-16 pb-4 sm:pt-24">
                    <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
                        <ProductSwitch product="office" linkToApp={linkToApp} />
                        <h1 className="font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-6xl sm:leading-[1.05] lg:text-7xl">
                            <span className="block">{ATTENDANCE_HERO.lead}</span>
                            <span className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                                {ATTENDANCE_HERO.beforeAccent}{" "}
                                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 sm:px-4">
                                    <span className="size-2.5 rounded-full bg-emerald-500 sm:size-3" aria-hidden />
                                    <span>{ATTENDANCE_HERO.accent}</span>
                                </span>
                            </span>
                        </h1>
                        <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                            <a
                                href={yearHref}
                                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500 sm:w-auto"
                            >
                                Começar no anual
                            </a>
                            <a
                                href="#planos"
                                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-50 px-5 py-3 text-base font-semibold text-emerald-800 transition-all duration-200 hover:bg-emerald-100 sm:w-auto"
                            >
                                Ver planos
                            </a>
                        </div>
                    </div>
                    <OfficeFlowSimulator />
                </section>
                <section id="produto" aria-labelledby="produto-titulo" className="scroll-mt-28 bg-slate-50">
                    <div className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 md:grid-cols-3 lg:py-16">
                        <h2 id="produto-titulo" className="sr-only">
                            O que o atendimento faz
                        </h2>
                        {ATTENDANCE_POINTS.map((point) => (
                            <article
                                key={point.title}
                                className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition duration-200 ease-out hover:-translate-y-1 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                            >
                                <h3 className="font-[family-name:var(--font-landing-display)] text-base font-extrabold tracking-tight text-slate-950 sm:text-lg">
                                    {point.title}
                                </h3>
                                <p className="mt-1.5 text-sm leading-snug text-slate-600">{point.body}</p>
                            </article>
                        ))}
                    </div>
                </section>
                <AttendancePlans linkToApp={linkToApp} />
                <Faq items={ATTENDANCE_FAQ} />
                <section className="bg-slate-100 px-4 py-20 sm:px-6 lg:py-28">
                    <div className="mx-auto max-w-3xl text-center">
                        <h2 className="font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-5xl">
                            Comece pelo anual.
                        </h2>
                        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
                            Cria a conta no checkout. No anual, o Office fica R$ 99,90 por mês.
                        </p>
                        <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                            <a
                                href={yearHref}
                                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:bg-emerald-500 sm:w-auto"
                            >
                                Começar no anual
                            </a>
                            <a
                                href={deliveryLandingHref(linkToApp)}
                                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-50 px-5 py-3 text-base font-semibold text-emerald-800 transition-all duration-200 hover:bg-emerald-100 sm:w-auto"
                            >
                                Ver o Delivery
                            </a>
                        </div>
                    </div>
                </section>
            </main>
            <MarketingFooter linkToApp={linkToApp} product="attendance" />
            <StickySignupCta href={yearHref} label="Começar no anual" note="R$ 99,90/mês no anual" />
            <SiteChat
                publicKey={siteChat?.publicKey}
                companyName={siteChat?.companyName}
                replies={siteChat?.replies}
            />
        </div>
    );
}
