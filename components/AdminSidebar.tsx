"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  MessageCircle,
  Printer,
  Settings,
} from "lucide-react";

const adminMenu = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Pedidos", href: "/pedidos", icon: Receipt },
  { label: "WhatsApp", href: "/whatsapp", icon: MessageCircle },
  { label: "Impressoras", href: "/impressoras", icon: Printer },
  { label: "Configurações", href: "/configuracoes", icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-64 flex-col border-r border-zinc-800 bg-gradient-to-b from-[#1e0b3a] via-[#120623] to-[#05010b] text-zinc-50 md:flex">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-bold shadow-[0_0_20px_rgba(234,88,12,0.25)]">
          R
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">Renthus ERP</div>
          <div className="text-[10px] font-medium text-zinc-300/70">
            Painel Administrativo
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {adminMenu.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                "text-zinc-200 hover:bg-white/5 hover:text-white",
                active ? "bg-white/8 text-white" : "",
              ].join(" ")}
            >
              {active && (
                <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-[#ea580c] shadow-[0_0_12px_rgba(234,88,12,0.7)]" />
              )}
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5 text-zinc-100 shadow-sm group-hover:bg-white/10">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-3 text-[11px] text-zinc-300/80">
        <div className="rounded-xl bg-white/5 px-3 py-2 backdrop-blur-sm">
          <div className="text-[11px] font-semibold text-zinc-50">
            Atalhos rápidos
          </div>
          <div className="mt-1 text-[10px]">
            Use o botão <span className="font-semibold text-[#ea580c]">Novo pedido</span> na tela de
            Pedidos para agilizar o atendimento.
          </div>
        </div>
      </div>
    </aside>
  );
}

