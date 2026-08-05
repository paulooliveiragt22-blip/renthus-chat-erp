/**
 * Validação do BR Code PIX (copia-e-cola).
 * Não aceitar “string longa” genérica — isso engolia PNG/binário como texto.
 */

/** EMV PIX válido (docs BCB / Pagar.me: começa com 000201…). */
export function isPixEmvPayload(raw: string): boolean {
    const s = raw.trim();
    if (!s.startsWith("000201")) return false;
    if (s.length < 50 || s.length > 600) return false;
    // Só ASCII imprimível (rejeita PNG/binário com � / IEND etc.)
    if (!/^[\x20-\x7E]+$/.test(s)) return false;
    const lower = s.toLowerCase();
    if (!lower.includes("br.gov.bcb.pix")) return false;
    return true;
}

/** Extrai o primeiro EMV válido de um texto (HTML/JSON). */
export function pickPixEmvFromText(text: string): string | null {
    if (!text || text.includes("\uFFFD") && !text.includes("000201")) return null;
    const trimmed = text.trim();
    if (isPixEmvPayload(trimmed)) return trimmed;
    const re = /000201[\x20-\x7E]{48,598}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
        const candidate = m[0].trim();
        if (isPixEmvPayload(candidate)) return candidate;
    }
    return null;
}

export function isImageMagic(buf: Buffer): boolean {
    if (buf.length < 12) return false;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (buf.toString("ascii", 0, 3) === "GIF") return true;
    if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
        return true;
    }
    return false;
}
