/**
 * Executa `worker` sobre `items` com no máximo `limit` tarefas em voo.
 * Erro em um item não aborta os demais — todos são tentados; o primeiro erro
 * é relançado no final (se houver).
 */
export async function runWithConcurrencyLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    const cap = Math.max(1, Math.floor(limit));
    if (items.length === 0) return;

    let cursor = 0;
    const errors: unknown[] = [];

    async function runNext(): Promise<void> {
        const index = cursor++;
        if (index >= items.length) return;
        try {
            await worker(items[index], index);
        } catch (err) {
            errors.push(err);
        }
        return runNext();
    }

    await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => runNext()));

    if (errors.length > 0) {
        throw errors[0];
    }
}
