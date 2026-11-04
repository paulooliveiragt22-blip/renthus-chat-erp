import { FAQ_ITEMS } from "@/lib/marketing/copy";

export function Faq() {
    return (
        <section aria-labelledby="faq" className="mx-auto max-w-3xl px-4 pb-8 sm:px-6">
            <h2 id="faq" className="text-2xl font-extrabold tracking-tight text-[#16364D] sm:text-3xl">
                Perguntas frequentes
            </h2>
            <div className="mt-6 divide-y divide-[#16364D]/10 rounded-2xl border border-[#16364D]/10 bg-white">
                {FAQ_ITEMS.map((item) => (
                    <details key={item.q} className="group px-5 py-4">
                        <summary className="cursor-pointer list-none font-bold text-[#16364D] [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center justify-between gap-4">
                                {item.q}
                                <span aria-hidden className="text-[#1a8f4a] group-open:rotate-45">
                                    +
                                </span>
                            </span>
                        </summary>
                        <p className="mt-3 text-sm leading-relaxed text-[#16364D]/75">{item.a}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}
