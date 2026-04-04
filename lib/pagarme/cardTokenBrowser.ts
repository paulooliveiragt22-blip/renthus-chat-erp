/**
 * Tokenização de cartão no browser (Pagar.me core v5 public key).
 * Não importar em rotas de servidor.
 */

export function parseCardExpiry(raw: string): { month: string; year: string } | null {
    const s = raw.replaceAll(/\s/g, "");
    const m = s.match(/^(\d{2})\/(\d{2,4})$/);
    if (!m) return null;
    let y = m[2];
    if (y.length === 4) y = y.slice(-2);
    return { month: m[1], year: y };
}

export async function pagarmeCreateCardToken(
    publicKey: string,
    p: {
        number:           string;
        holder_name:      string;
        exp_month:        string | number;
        exp_year:         string | number;
        cvv:              string;
        holder_document?: string;
        billing_address?: {
            street:       string;
            number:       string;
            neighborhood: string;
            zipcode:      string;
            city:         string;
            state:        string;
            country?:     string;
        };
    }
): Promise<string> {
    const card: Record<string, unknown> = {
        number:      p.number.replaceAll(/\D/g, ""),
        holder_name: p.holder_name.replaceAll(/[^a-zA-ZÀ-ÿ\s]/g, "").trim() || p.holder_name.trim(),
        exp_month:   Number(p.exp_month),
        exp_year:    Number(p.exp_year),
        cvv:         p.cvv.replaceAll(/\D/g, ""),
    };

    if (p.holder_document) {
        card.holder_document = p.holder_document.replaceAll(/\D/g, "");
    }

    if (p.billing_address) {
        const b = p.billing_address;
        card.billing_address = {
            street:       b.street,
            number:       b.number,
            neighborhood: b.neighborhood,
            zipcode:      b.zipcode.replaceAll(/\D/g, ""),
            city:         b.city,
            state:        b.state,
            country:      b.country ?? "BR",
        };
    }

    const res = await fetch(
        `https://api.pagar.me/core/v5/tokens?appId=${encodeURIComponent(publicKey)}`,
        {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ type: "card", card }),
        }
    );
    const data = (await res.json()) as { message?: string; id?: string };
    if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : "Não foi possível validar o cartão.");
    }
    if (!data?.id) throw new Error("Resposta inválida do Pagar.me.");
    return data.id;
}
