/** Texto WhatsApp ao oferecer o cardápio web (puro — sem I/O). */
export function buildWebMenuOfferText(opts: {
    url: string;
    companyName?: string | null;
}): string {
    const name = (opts.companyName ?? "").trim();
    const intro = name
        ? `Aqui está o cardápio online do *${name}*:`
        : "Aqui está nosso cardápio online:";
    return (
        `${intro}\n\n${opts.url}\n\n` +
        "Abra o link, escolha os itens e me diga o que deseja pedir. 😊"
    );
}
