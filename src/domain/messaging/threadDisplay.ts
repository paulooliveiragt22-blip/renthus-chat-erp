/**
 * Labels de inbox omnichannel (B10).
 * Sem phone: profile name Meta → fallback por canal.
 */

export type ThreadDisplayInput = {
    channel?: string | null;
    profileName?: string | null;
    phoneE164?: string | null;
    externalId?: string | null;
};

export function channelBadgeLabel(channel: string | null | undefined): string {
    switch (channel) {
        case "instagram":
            return "IG";
        case "messenger":
            return "FB";
        case "whatsapp":
            return "WA";
        default:
            return "WA";
    }
}

export function threadDisplayName(t: ThreadDisplayInput): string {
    const name = (t.profileName ?? "").trim();
    if (name) return name;
    const phone = (t.phoneE164 ?? "").trim();
    if (phone) return phone;
    if (t.channel === "instagram") return "Cliente Instagram";
    if (t.channel === "messenger") return "Cliente Messenger";
    return "Cliente";
}

/** Subtítulo sob o nome: phone, ou id curto do canal, ou label do canal. */
export function threadDisplaySubtitle(t: ThreadDisplayInput): string {
    const phone = (t.phoneE164 ?? "").trim();
    if (phone) return phone;
    const ext = (t.externalId ?? "").trim();
    if (ext) {
        if (t.channel === "instagram") return `IG · ${ext.slice(0, 6)}…`;
        if (t.channel === "messenger") return `Messenger · ${ext.slice(0, 6)}…`;
        return ext.slice(0, 12);
    }
    if (t.channel === "instagram") return "Instagram";
    if (t.channel === "messenger") return "Messenger";
    return "WhatsApp";
}
