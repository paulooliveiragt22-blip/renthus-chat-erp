/**
 * Fairness best-effort no worker: evita processar o mesmo `company_id` em sequência
 * dentro de um lote de jobs já claimados. Não altera ordem global na fila SQL.
 */
export function interleaveQueueJobsByCompany<T extends { company_id?: string | null }>(
    jobs: T[]
): T[] {
    if (jobs.length <= 2) return [...jobs];

    const byCompany = new Map<string, T[]>();
    for (const j of jobs) {
        const k = String(j.company_id ?? "");
        const arr = byCompany.get(k);
        if (arr) arr.push(j);
        else byCompany.set(k, [j]);
    }

    const companyKeys = [...byCompany.keys()];
    const out: T[] = [];
    let lastCompany = "\0";

    while (out.length < jobs.length) {
        const withWork = companyKeys.filter((c) => (byCompany.get(c)?.length ?? 0) > 0);
        if (!withWork.length) break;

        const preferOther = withWork.filter((c) => c !== lastCompany);
        const pickKey = preferOther.length ? preferOther[0] : withWork[0];
        const bucket = byCompany.get(pickKey);
        const next = bucket?.shift();
        if (!next) break;

        out.push(next);
        lastCompany = String(next.company_id ?? "");
    }

    return out;
}
