"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiGrid, FiBarChart2, FiUsers, FiBox, FiMessageSquare, FiFileText } from "react-icons/fi";

const menu = [
  { label: "Dashboard", href: "/dashboard", icon: <FiGrid /> },
  { label: "Products", href: "/produtos", icon: <FiBox /> },
  { label: "Orders", href: "/app/pedidos", icon: <FiFileText /> },
  { label: "Customers", href: "/customers", icon: <FiUsers /> },
  { label: "Analytics", href: "/dashboard/statistics", icon: <FiBarChart2 /> },
  { label: "Messages", href: "/whatsapp", icon: <FiMessageSquare /> },
];

export default function ProdifySidebar({ className = "" }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside className={`hidden md:flex md:w-64 bg-prodifyPurple text-white p-6 flex-col ${className}`}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-md bg-prodifyOrange flex items-center justify-center font-bold shadow">P</div>
        <div>
          <div className="text-lg font-semibold">Prodify</div>
          <div className="text-xs text-white/70">Sales Control</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        {menu.map((m) => {
          const active = pathname === m.href || pathname?.startsWith(m.href + "/");
          return (
            <Link key={m.href} href={m.href} className={`sidebar-link ${active ? "sidebar-link-active" : ""}`}>
              <span className="text-lg">{m.icon}</span>
              <span>{m.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center font-semibold">VC</div>
          <div>
            <div className="font-semibold">Victoria Chambers</div>
            <div className="text-xs text-white/70">Admin</div>
          </div>
        </div>
        <button className="w-full btn-primary">New Report</button>
      </div>
    </aside>
  );
}
