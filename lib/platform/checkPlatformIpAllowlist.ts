function isProductionEnv(): boolean {
    return (
        process.env.VERCEL_ENV === "production" ||
        process.env.NODE_ENV === "production"
    );
}

/** Remove aspas/BOM e normaliza IPv4 mapeado em IPv6 (::ffff:a.b.c.d). */
export function normalizeIp(raw: string): string {
    let ip = raw.trim().replace(/^["']|["']$/g, "");
    if (ip.startsWith("[") && ip.endsWith("]")) {
        ip = ip.slice(1, -1);
    }
    const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (v4Mapped?.[1]) return v4Mapped[1];
    return ip;
}

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
        const v = Number(p);
        if (!Number.isInteger(v) || v < 0 || v > 255) return null;
        n = (n << 8) + v;
    }
    return n >>> 0;
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
    const [base, bitsStr] = cidr.split("/");
    const bits = bitsStr ? Number(bitsStr) : 32;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

    const ipInt = ipv4ToInt(ip);
    const baseInt = ipv4ToInt(base);
    if (ipInt === null || baseInt === null) return false;

    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipInt & mask) === (baseInt & mask);
}

function parseAllowlist(raw: string): string[] {
    return raw
        .split(/[\s,;]+/)
        .map((s) => normalizeIp(s))
        .filter(Boolean);
}

/** Coleta candidatos de IP a partir dos headers da Vercel/proxy. */
export function collectClientIpCandidates(headers: {
    get(name: string): string | null;
}, requestIp?: string | null): string[] {
    const out: string[] = [];
    const push = (v: string | null | undefined) => {
        if (!v) return;
        const n = normalizeIp(v);
        if (n && !out.includes(n)) out.push(n);
    };

    push(requestIp ?? undefined);

    for (const name of [
        "x-vercel-forwarded-for",
        "x-forwarded-for",
        "x-real-ip",
        "cf-connecting-ip",
    ]) {
        const raw = headers.get(name);
        if (!raw) continue;
        for (const part of raw.split(",")) {
            push(part);
        }
    }

    return out;
}

export function extractClientIp(forwardedFor: string | null, realIp: string | null): string {
    const candidates = collectClientIpCandidates({
        get(name) {
            if (name === "x-forwarded-for") return forwardedFor;
            if (name === "x-real-ip") return realIp;
            return null;
        },
    });
    return candidates[0] ?? "";
}

function ipMatchesEntry(ip: string, entry: string): boolean {
    if (entry.includes("/")) return ipMatchesCidr(ip, entry);
    return ip === entry;
}

export function isIpAllowed(
    clientIp: string,
    allowlistCsv: string | undefined,
    extraCandidates: string[] = []
): boolean {
    if (!isProductionEnv()) return true;

    const list = parseAllowlist(allowlistCsv ?? process.env.PLATFORM_ADMIN_IP_ALLOWLIST ?? "");
    if (list.length === 0) return false;

    const candidates = [
        ...new Set(
            [clientIp, ...extraCandidates]
                .map((c) => normalizeIp(c))
                .filter(Boolean)
        ),
    ];
    if (candidates.length === 0) return false;

    for (const ip of candidates) {
        for (const entry of list) {
            if (ipMatchesEntry(ip, entry)) return true;
        }
    }
    return false;
}

export function checkPlatformIpAllowlist(headers: {
    get(name: string): string | null;
}): { ok: true } | { ok: false; reason: string } {
    const candidates = collectClientIpCandidates(headers);
    if (isIpAllowed(candidates[0] ?? "", process.env.PLATFORM_ADMIN_IP_ALLOWLIST, candidates)) {
        return { ok: true };
    }
    return { ok: false, reason: "ip_not_allowed" };
}
