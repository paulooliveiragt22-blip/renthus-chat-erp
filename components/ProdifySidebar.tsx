"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FiGrid,
  FiBarChart2,
  FiUsers,
  FiBox,
  FiMessageSquare,
  FiFileText,
  FiChevronLeft,
  FiChevronRight,
  FiUser,
} from "react-icons/fi";

const menu = [
  { label: "Dashboard", href: "/dashboard", icon: <FiGrid /> },
  { label: "Products", href: "/produtos", icon: <FiBox /> },
  { label: "Orders", href: "/app/pedidos", icon: <FiFileText /> },
  { label: "Customers", href: "/customers", icon: <FiUsers /> },
  { label: "Analytics", href: "/dashboard/statistics", icon: <FiBarChart2 /> },
  { label: "Messages", href: "/whatsapp", icon: <FiMessageSquare /> },
];

export default function ProdifySidebar() {
  const pathname = usePathname();
  // sidebar collapsed by default (only icons)
  const [collapsed, setCollapsed] = useState<boolean>(true);
  // user panel open (floating or inline)
  const [userOpen, setUserOpen] = useState<boolean>(false);

  // optional: remember collapsed in localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("renthus_sidebar_collapsed");
      if (saved !== null) setCollapsed(saved === "true");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("renthus_sidebar_collapsed", String(collapsed));
    } catch { }
  }, [collapsed]);

  const toggle = () => {
    setCollapsed((s) => !s);
    setUserOpen(false);
  };

  const toggleUser = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setUserOpen((u) => !u);
  };

  return (
    <aside
      className={`relative bg-prodifyPurple text-white flex flex-col transition-all duration-300 ease-in-out
        ${collapsed ? "w-20" : "w-64"}`}
      aria-expanded={!collapsed}
    >
      {/* Top: brand + toggle */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center rounded-md ${collapsed ? "w-10 h-10" : "w-10 h-10"
              } bg-prodifyOrange font-bold shadow`}
          >
            P
          </div>

          {!collapsed && (
            <div>
              <div className="text-lg font-semibold">Prodify</div>
              <div className="text-xs text-white/80">Sales Control</div>
            </div>
          )}
        </div>

        {/* toggle button */}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggle}
          className="p-1 rounded hover:bg-white/10 transition"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <FiChevronRight size={18} /> : <FiChevronLeft size={18} />}
        </button>
      </div>

      {/* Menu */}
      <nav className="flex-1 px-1 py-2">
        <ul className="flex flex-col gap-1">
          {menu.map((m) => {
            const active = pathname === m.href || pathname?.startsWith(m.href + "/");
            return (
              <li key={m.href}>
                <Link
                  href={m.href}
                  className={`flex items-center gap-3 p-2 rounded-md text-sm transition hover:bg-white/10 ${active ? "bg-white/10 font-semibold" : "text-white/90"
                    }`}
                  title={m.label}
                >
                  <span className="text-lg flex-shrink-0 text-white">{m.icon}</span>
                  {/* label shown only when expanded */}
                  {!collapsed && <span className="truncate">{m.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* bottom: user area */}
      <div className="p-3 border-t border-white/10">
        {/* collapsed: show small avatar that can open floating user panel */}
        {collapsed ? (
          <div className="relative">
            <button
              className="w-full flex items-center justify-center p-2 rounded hover:bg-white/10 transition"
              onClick={toggleUser}
              aria-expanded={userOpen}
              title="Open user menu"
            >
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white font-semibold">
                VC
              </div>
            </button>

            {/* floating panel when userOpen */}
            {userOpen && (
              <div
                className="absolute left-full top-0 ml-3 w-48 bg-white text-gray-800 rounded-lg shadow-lg p-3 z-40"
                style={{ minWidth: 180 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-prodifyPurple text-white flex items-center justify-center font-semibold">VC</div>
                  <div>
                    <div className="font-semibold">Victoria Chambers</div>
                    <div className="text-xs text-gray-500">Admin</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Link href="/profile" className="block px-3 py-2 rounded hover:bg-gray-100">Profile</Link>
                  <Link href="/reports/new" className="block px-3 py-2 rounded hover:bg-gray-100">New Report</Link>
                  <button className="w-full text-left px-3 py-2 rounded hover:bg-gray-100" onClick={() => { /* logout */ }}>
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          // expanded: inline user area with buttons visible
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-semibold">VC</div>
              <div>
                <div className="font-semibold">Victoria Chambers</div>
                <div className="text-xs text-white/80">Admin</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Link href="/profile" className="px-3 py-2 rounded-md hover:bg-white/10">Profile</Link>
              <Link href="/reports/new" className="px-3 py-2 rounded-md hover:bg-white/10">New Report</Link>
              <button className="px-3 py-2 rounded-md hover:bg-white/10 text-left" onClick={() => { /* logout */ }}>
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
