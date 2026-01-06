"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

const menuItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Products", href: "#products" },
  { label: "Orders", href: "#orders" },
  { label: "Customers", href: "#customers" },
  { label: "Analytics", href: "#analytics" },
];

export default function ProdifySidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-full md:w-64 bg-prodifyPurple text-white min-h-full md:min-h-screen flex flex-col">
      <div className="p-6 flex items-center gap-3 border-b border-white/10">
        <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center font-bold text-lg">P</div>
        <div>
          <div className="text-lg font-bold leading-tight">Prodify</div>
          <div className="text-xs text-white/60">Sales Control</div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1">
        {menuItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                active ? "bg-white/10 font-semibold" : "hover:bg-white/5"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-prodifyOrange" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center font-semibold">VC</div>
          <div>
            <div className="font-semibold">Victoria Chambers</div>
            <div className="text-xs text-white/60">Admin</div>
          </div>
        </div>
        <button className="w-full bg-prodifyOrange text-white py-2 rounded-lg font-semibold">New Report</button>
      </div>
    </aside>
  );
}
