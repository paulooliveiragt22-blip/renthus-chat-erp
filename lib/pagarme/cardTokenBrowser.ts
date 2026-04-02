/**
 * Tokenização de cartão no browser (Pagar.me core v5 public key).
 * Não importar em rotas de servidor.
 */

export function parseCardExpiry(raw: string): { month: string; year: string } | null {
    const s = raw.replace(/\s/g, "");
    const m = s.match(/^(\d{2})\/(\d{2,4})$/);
    if (!m) return null;
    let y = m[2];
    if (y.length === 4) y = y.slice(-2);
    return { month: m[1], year: y };
}

export async function pagarmeCreateCardToken(
    publicKey: string,
    p: {
        number: string;
        holder_name: string;
        exp_month: string;
        exp_year: string;
        cvv: string;
        holder_document?: string;
    }
): Promise<string> {
    const res = await fetch(
        `https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`,
        {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                type: "card",
                card: {
                    number:      p.number.replace(/\D/g, ""),
                    holder_name: p.holder_name.replace(/[^a-zA-ZÀ-ÿ\s]/g, "").trim() || p.holder_name.trim(),
                    exp_month:   p.exp_month,
                    exp_year:    p.exp_year,
                    cvv:         p.cvv.replace(/\D/g, ""),
                    ...(p.holder_document && { holder_document: p.holder_document }),
                },
            }),
        }
    );
    const data = (await res.json()) as { message?: string; id?: string };
    if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível validar o cartão.");
    }
    if (!data?.id) throw new Error("Resposta inválida do Pagar.me.");
    return data.id;
}
