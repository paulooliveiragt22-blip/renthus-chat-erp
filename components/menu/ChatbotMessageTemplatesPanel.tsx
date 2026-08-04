"use client";

type Props = {
    welcomeReturning: string;
    welcomeFirst: string;
    outForDelivery: string;
    thankYou: string;
    onChange: (patch: {
        welcomeReturning?: string;
        welcomeFirst?: string;
        outForDelivery?: string;
        thankYou?: string;
    }) => void;
    disabled?: boolean;
};

function Field({
    label,
    hint,
    value,
    onChange,
    disabled,
    rows = 3,
}: {
    label: string;
    hint: string;
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    rows?: number;
}) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {label}
            </span>
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                rows={rows}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <p className="text-[11px] text-zinc-400">{hint}</p>
        </label>
    );
}

export default function ChatbotMessageTemplatesPanel({
    welcomeReturning,
    welcomeFirst,
    outForDelivery,
    thankYou,
    onChange,
    disabled,
}: Props) {
    return (
        <div className="space-y-4 rounded-xl border border-zinc-100 p-5 dark:border-zinc-800">
            <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Mensagens para o cliente
                </h3>
                <p className="mt-1 text-xs text-zinc-500">
                    Só o texto da saudação é editável — instruções do menu e botões permanecem fixos.
                    Placeholders: {"{nome}"}, {"{nome_parte}"} (vírgula + nome ou vazio), {"{empresa}"}.
                </p>
            </div>

            <Field
                label="Saudação — cliente que já pediu / tem cadastro"
                hint="Ex.: Bem-vindo de volta! … (sem a frase dos botões)"
                value={welcomeReturning}
                onChange={(v) => onChange({ welcomeReturning: v })}
                disabled={disabled}
            />
            <Field
                label="Saudação — primeiro contato"
                hint="Ex.: Oi! Sou o assistente da loja…"
                value={welcomeFirst}
                onChange={(v) => onChange({ welcomeFirst: v })}
                disabled={disabled}
            />
            <Field
                label="Pedido saiu para entrega"
                hint="Enviada ao marcar “Saiu pra entrega” nos Pedidos."
                value={outForDelivery}
                onChange={(v) => onChange({ outForDelivery: v })}
                disabled={disabled}
            />
            <Field
                label="Agradecimento (pedido entregue / finalizado)"
                hint="Enviada ao finalizar o pedido com WhatsApp."
                value={thankYou}
                onChange={(v) => onChange({ thankYou: v })}
                disabled={disabled}
            />
        </div>
    );
}
