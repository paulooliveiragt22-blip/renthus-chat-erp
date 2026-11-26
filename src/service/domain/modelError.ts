export function sanitizeModelError(error: unknown): string {
    const name = error instanceof Error ? error.name : "Error";
    const status =
        error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
            ? ` ${error.statusCode}`
            : "";
    const message = error instanceof Error ? error.message : "failed";
    const clean = message.replace(/sk-[A-Za-z0-9_-]+/gu, "[key]").replace(/\s+/gu, " ").trim().slice(0, 180);
    return `${name}${status}: ${clean}`.slice(0, 240);
}
