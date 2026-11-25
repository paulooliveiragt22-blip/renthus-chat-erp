import { FEATURE_CHAPTERS } from "@/lib/marketing/copy";
import { getLandingLoop } from "@/lib/marketing/loops";
import { MarketingLoop } from "@/components/marketing/MarketingLoop";
import { cn } from "@/lib/utils";

export function FeatureChapters() {
    return (
        <div id="produto">
            {FEATURE_CHAPTERS.map((chapter, index) => {
                const loop = getLandingLoop(chapter.loopId);
                const reversed = index % 2 === 1;
                return (
                    <section
                        key={chapter.id}
                        id={chapter.id}
                        aria-labelledby={`${chapter.id}-titulo`}
                        className={cn("scroll-mt-28", index % 2 === 0 ? "bg-white" : "bg-slate-50")}
                    >
                        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-2 md:py-24">
                            <div className={cn(reversed && "md:order-2")}>
                                <p className="text-sm font-semibold text-emerald-700">{chapter.kicker}</p>
                                <h2
                                    id={`${chapter.id}-titulo`}
                                    className="mt-3 font-[family-name:var(--font-landing-display)] text-3xl font-semibold tracking-tight text-balance text-slate-950 sm:text-4xl sm:leading-[1.1]"
                                >
                                    {chapter.title}
                                </h2>
                                <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">{chapter.body}</p>
                            </div>
                            <div
                                className={cn(
                                    "overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-100 shadow-sm",
                                    chapter.id === "cardapio" ? "mx-auto aspect-[9/16] w-full max-w-sm" : "aspect-video",
                                    reversed && "md:order-1"
                                )}
                            >
                                <MarketingLoop
                                    loop={loop}
                                    fallback={
                                        <ol className="flex h-full flex-col justify-center gap-3 bg-slate-50 p-6 sm:p-8">
                                            {loop.beats.map((beat, beatIndex) => (
                                                <li key={beat} className="flex items-start gap-3 text-sm leading-snug text-slate-700">
                                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white tabular-nums">
                                                        {beatIndex + 1}
                                                    </span>
                                                    <span>{beat}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    }
                                />
                            </div>
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
