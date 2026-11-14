"use client";

import { PLAN_GUARANTEE } from "@/lib/marketing/copy";
import { accountHref } from "@/lib/marketing/hosts";

type StickySignupCtaProps = {
    linkToApp?: boolean;
};

export function StickySignupCta({ linkToApp = false }: StickySignupCtaProps) {
    const href = accountHref("/signup?plano=pro&periodo=year", linkToApp);

    return (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-md lg:hidden">
            <a
                href={href}
                className="flex w-full items-center justify-center rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20"
            >
                Começar no Pro anual
            </a>
            <p className="mt-1.5 text-center text-[0.7rem] leading-snug text-slate-500">
                {PLAN_GUARANTEE}
            </p>
        </div>
    );
}
