export function roundMoney(n: number): number {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function asMoney(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? roundMoney(n) : 0;
}
