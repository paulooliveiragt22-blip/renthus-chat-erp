/** Gera CNPJ válido (checksum) para signup E2E — único por execução. */

function calcCnpjCheckDigit(base: number[], weights: number[]): number {
    const sum = base.reduce((acc, d, i) => acc + d * weights[i], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
}

export function generateValidCnpj(): string {
    const rnd = Math.floor(Math.random() * 99_999_999)
        .toString()
        .padStart(8, "0");
    const digits = [...rnd.split("").map(Number), 0, 0, 0, 1];
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d1 = calcCnpjCheckDigit(digits, w1);
    digits.push(d1);
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d2 = calcCnpjCheckDigit(digits, w2);
    digits.push(d2);
    return digits.join("");
}
