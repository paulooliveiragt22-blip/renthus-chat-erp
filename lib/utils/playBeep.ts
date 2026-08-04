let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    try {
        if (typeof window === "undefined") return null;
        const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return null;
        if (!sharedCtx) sharedCtx = new Ctx();
        return sharedCtx;
    } catch {
        return null;
    }
}

/** Desbloqueia áudio após gesto do usuário (necessário nos browsers modernos). */
export function unlockOrderAlertAudio(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
    }
}

function tone(
    ctx: AudioContext,
    freq: number,
    startAt: number,
    duration: number,
    volume = 0.35
): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
}

/** Alerta sonoro de pedido novo (3 tons — mais perceptível que um beep curto). */
export function playBeep(): void {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const play = () => {
            const t0 = ctx.currentTime;
            tone(ctx, 880, t0, 0.18, 0.4);
            tone(ctx, 1175, t0 + 0.2, 0.18, 0.4);
            tone(ctx, 1319, t0 + 0.4, 0.28, 0.45);
        };
        if (ctx.state === "suspended") {
            void ctx.resume().then(play).catch(() => {});
            return;
        }
        play();
    } catch {
        /* ignore */
    }
}
