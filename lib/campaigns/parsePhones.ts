const MAX_PHONES = 500;

export function normalizeCampaignPhone(raw: string | null | undefined): string | null {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
    if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
    return `+${digits}`;
}

function phonesInChunk(chunk: string): string[] {
    const groups = chunk.match(/\d+/g) ?? [];
    const separate = groups
        .map((group) => (group.length >= 10 ? normalizeCampaignPhone(group) : null))
        .filter((phone): phone is string => Boolean(phone));
    if (separate.length > 0) return separate;
    const joined = normalizeCampaignPhone(groups.join(""));
    return joined ? [joined] : [];
}

/** Um número por linha, com ou sem 55, espaço ou traço. */
export function parseCampaignPhones(raw: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const chunk of raw.split(/[\n,;]+/)) {
        for (const phone of phonesInChunk(chunk)) {
            if (seen.has(phone)) continue;
            seen.add(phone);
            out.push(phone);
            if (out.length >= MAX_PHONES) return out;
        }
    }
    return out;
}
