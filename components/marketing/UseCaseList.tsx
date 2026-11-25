import { ArrowRight, Megaphone, MessageCircle, Printer, Store } from "lucide-react";
import { USE_CASES } from "@/lib/marketing/copy";

const ICONS = {
    whatsapp: MessageCircle,
    pdv: Store,
    print: Printer,
    campaign: Megaphone,
} as const;

export function UseCaseList() {
    return (
        <section aria-labelledby="usos" className="scroll-mt-28 bg-white">
            <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:py-24">
                <h2
                    id="usos"
                    className="font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl"
                >
                    Veja o que a loja passa a fazer
                </h2>
                <ul className="mt-8 space-y-3">
                    {USE_CASES.map((item) => {
                        const Icon = ICONS[item.icon];
                        return (
                            <li key={item.label}>
                                <a
                                    href={item.href}
                                    className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white px-4 py-4 text-slate-950 shadow-sm transition-all duration-200 hover:bg-slate-50"
                                >
                                    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                                        <Icon className="size-4" aria-hidden />
                                    </span>
                                    <span className="min-w-0 flex-1 text-sm font-semibold sm:text-base">{item.label}</span>
                                    <ArrowRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}
