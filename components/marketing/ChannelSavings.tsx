import { LOYALTY } from "@/lib/marketing/copy";
import {
    formatBrlFromCents,
    savingsExample,
} from "@/lib/marketing/marketplaceFees";

type ChannelSavingsProps = {
    zampellMonthlyCents: number;
};

export function ChannelSavings({ zampellMonthlyCents }: ChannelSavingsProps) {
    const example = savingsExample(zampellMonthlyCents);
    const ifood = example.keptVersus.find((row) => row.id === "ifood");

    return (
        <section id="economia" aria-labelledby="economia-titulo" className="scroll-mt-24 bg-[#16364D] text-white">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
                <h2 id="economia-titulo" className="max-w-3xl text-2xl font-extrabold tracking-tight text-balance sm:text-3xl">
                    No app, a comissão sai de cada pedido. No seu canal, a mensalidade é fixa.
                </h2>
                <p className="mt-4 max-w-3xl text-base leading-relaxed text-white/80">
                    Exemplo com {formatBrlFromCents(example.volumeCents)} em pedidos no mês, entrega feita
                    pela loja e pagamento dentro do aplicativo. A Zampell entra com a mensalidade de lista
                    do Pro ({formatBrlFromCents(example.zampellCents)}), sem percentual sobre a venda.
                </p>

                <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10">
                    <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                        <caption className="sr-only">
                            Custo de referência dos apps contra a mensalidade do plano Pro neste exemplo
                        </caption>
                        <thead className="bg-white/5 text-xs tracking-wide text-white/70 uppercase">
                            <tr>
                                <th scope="col" className="px-4 py-3 font-semibold">Canal</th>
                                <th scope="col" className="px-4 py-3 font-semibold">O que sai</th>
                                <th scope="col" className="px-4 py-3 font-semibold">Neste exemplo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {example.rows.map((row) => (
                                <tr key={row.id} className="border-t border-white/10">
                                    <th scope="row" className="px-4 py-3 font-semibold text-white">
                                        {row.name}
                                    </th>
                                    <td className="px-4 py-3 text-white/80">{row.takeLabel}</td>
                                    <td className="px-4 py-3 font-bold tabular-nums">
                                        {formatBrlFromCents(row.costCents)}
                                    </td>
                                </tr>
                            ))}
                            <tr className="border-t border-[#57ff8f]/40 bg-[#57ff8f]/10">
                                <th scope="row" className="px-4 py-3 font-semibold">
                                    Zampell · Pro
                                </th>
                                <td className="px-4 py-3 text-white/80">Mensalidade fixa, sem % por pedido</td>
                                <td className="px-4 py-3 font-extrabold text-[#57ff8f] tabular-nums">
                                    {formatBrlFromCents(example.zampellCents)}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {ifood && ifood.keptCents > 0 ? (
                    <p className="mt-6 max-w-3xl text-lg font-semibold text-[#57ff8f]">
                        Contra o iFood, neste exemplo, ficam {formatBrlFromCents(ifood.keptCents)} a mais na loja.
                    </p>
                ) : null}

                <ul className="mt-4 max-w-3xl space-y-2 text-sm leading-relaxed text-white/75">
                    {example.rows.map((row) => (
                        <li key={row.id}>
                            {row.name}: {row.detail}{" "}
                            <a
                                href={row.sourceUrl}
                                className="underline decoration-white/40 underline-offset-2 hover:text-white"
                                target="_blank"
                                rel="noreferrer"
                            >
                                {row.sourceLabel}
                            </a>
                            .
                        </li>
                    ))}
                </ul>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/60">
                    Se o aplicativo também manda o motoboy, a referência muda: iFood Plano Entrega 23% + 3,2%,
                    Aiqfome 19,99%, 99Food 8,9% mais custo por km. O motoboy da loja continua no canal próprio.
                    PIX e cartão na sua maquininha têm a taxa da operadora. No anual, o Pro sai menos por mês
                    e a diferença aumenta.
                </p>

                <h3 className="mt-14 text-2xl font-extrabold tracking-tight">
                    Quem já comprou volta no seu WhatsApp e no seu cardápio
                </h3>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                    {LOYALTY.map((item) => (
                        <article key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                            <h4 className="text-base font-extrabold">{item.title}</h4>
                            <p className="mt-2 text-sm leading-relaxed text-white/75">{item.body}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
