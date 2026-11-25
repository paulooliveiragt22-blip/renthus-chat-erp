"use client";

import { LANDING_LOOPS } from "@/lib/marketing/loops";
import { LiveFlowSimulator } from "@/components/marketing/LiveFlowSimulator";
import { MarketingLoop } from "@/components/marketing/MarketingLoop";

export function ProductStage() {
    return (
        <div id="fluxo-agente" className="relative mx-auto mt-16 max-w-6xl scroll-mt-28 px-4">
            <div className="overflow-hidden rounded-t-3xl border border-b-0 border-slate-200/80 bg-white shadow-[0_40px_80px_-48px_rgba(15,23,42,0.55)]">
                <div className="h-[28rem] overflow-hidden sm:h-[34rem]">
                    <MarketingLoop
                        loop={LANDING_LOOPS.whatsapp}
                        fallback={<LiveFlowSimulator bare />}
                    />
                </div>
            </div>
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-4 bottom-0 h-20 bg-gradient-to-t from-white to-transparent"
            />
        </div>
    );
}
