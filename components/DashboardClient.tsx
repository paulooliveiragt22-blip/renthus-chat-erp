"use client";
import React, { useEffect, useState } from "react";
import ProdifySidebar from "@/components/ProdifySidebar";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#6F4ACF", "#0DAA00", "#FF6600"];

type Order = {
  id: string;
  created_at: string;
  customers?: { name?: string } | null;
  total_amount?: number;
  status?: string;
};

type OrderStats = {
  stats?: { totalRevenue?: number };
  daily?: { date: string; revenue: number }[];
};

type StatusSummary = Record<string, { count?: number } | number> | null;

export default function DashboardClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [statusSummary, setStatusSummary] = useState<StatusSummary>(null);

  useEffect(() => {
    fetch("/api/orders/list?limit=8", { credentials: "include" })
      .then((r) => r.json())
      .then((json) => setOrders(Array.isArray(json.orders) ? json.orders : []))
      .catch(() => setOrders([]));

    fetch("/api/orders/stats", { credentials: "include" })
      .then((r) => r.json())
      .then((json) => setStats(json))
      .catch(() => setStats(null));

    fetch("/api/orders/status", { credentials: "include" })
      .then((r) => r.json())
      .then((json) => setStatusSummary(json?.summary ?? null))
      .catch(() => setStatusSummary(null));
  }, []);

  function fmtBRL(n?: number) {
    return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }

  const pieData = statusSummary
    ? Object.entries(statusSummary).map(([k, v]: any) => ({ name: k, value: v.count ?? v }))
    : [
        { name: "A", value: 58 },
        { name: "B", value: 20 },
        { name: "C", value: 22 },
      ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-50">
      <ProdifySidebar />

      <main className="flex-1 p-6 md:p-8">
        {/* Top bar */}
        <div className="flex items-center gap-4 mb-6">
          <h2 className="text-2xl font-semibold">Sales Admin</h2>
          <div className="flex-1" />
          <div className="w-full max-w-md">
            <input
              className="w-full p-2 rounded-md border border-gray-200"
              placeholder="Prodify Finder"
            />
          </div>
          <button className="ml-3 bg-prodifyPurple text-white px-4 py-2 rounded-md font-semibold">
            Add new product
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 bg-white p-5 rounded-lg shadow-sm">
            <div className="text-prodifyOrange font-bold">Update</div>
            <h3 className="mt-2 text-xl font-bold">
              This Week&apos;s Sales Revenue
              <br />
              <span className="text-prodifyGreen">Increased by 40%</span>
            </h3>
            <div className="mt-4 text-gray-500">Monitor Stats &gt;</div>
          </div>

          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="font-semibold">Total Earnings</div>
            <div className="text-2xl font-bold mt-2">R$ {fmtBRL(stats?.stats?.totalRevenue)}</div>
            <div className="text-sm text-gray-500 mt-2">Up 35% Month-over-Month</div>
          </div>

          <div className="bg-white p-5 rounded-lg shadow-sm">
            <div className="font-semibold">Net Return</div>
            <div className="text-2xl font-bold mt-2">
              R$ {fmtBRL((stats?.stats?.totalRevenue || 0) * 0.2)}
            </div>
            <div className="text-sm text-gray-500 mt-2">Down 15% Month-over-Month</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-5 rounded-lg shadow-sm">
              <div className="font-bold text-lg mb-4">Transaction</div>
              <div className="divide-y">
                {orders.map((o) => (
                  <div key={o.id} className="py-3 flex justify-between items-center">
                    <div>
                      <div className="font-semibold">{o.customers?.name ?? "-"}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(o.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">R$ {fmtBRL(o.total_amount)}</div>
                      <div
                        className={`text-xs mt-1 ${
                          o.status === "new" ? "text-prodifyGreen" : "text-prodifyOrange"
                        }`}
                      >
                        {o.status}
                      </div>
                    </div>
                  </div>
                ))}
                {orders.length === 0 && (
                  <div className="py-4 text-sm text-gray-500">Nenhuma transação encontrada.</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <div className="font-semibold">Revenue</div>
                <div className="text-2xl font-bold mt-2">R$ {fmtBRL(stats?.stats?.totalRevenue)}</div>
                <div className="h-36 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={(stats?.daily ?? []).map((d: any) => ({ date: d.date, revenue: d.revenue }))}>
                      <XAxis dataKey="date" hide />
                      <YAxis hide />
                      <Tooltip formatter={(value: any) => [`R$ ${fmtBRL(value as number)}`, "Receita"]} />
                      <Line type="monotone" dataKey="revenue" stroke="#3B246B" strokeWidth={3} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm">
                <div className="font-semibold">Sales Report</div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>Product Launched</span>
                      <span className="font-bold">233</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded mt-2">
                      <div className="h-2 bg-prodifyPurple rounded" style={{ width: "70%" }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm">
                      <span>Ongoing product</span>
                      <span className="font-bold">180</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded mt-2">
                      <div className="h-2 bg-prodifyOrange rounded" style={{ width: "50%" }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* right column */}
          <aside className="space-y-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex justify-between items-center">
                <div className="font-semibold">Total view performance</div>
              </div>
              <div className="h-48 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={4}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center font-bold mt-2">
                Total count
                <br />
                496K
              </div>
            </div>

            <div className="bg-prodifyPurple text-white p-4 rounded-lg shadow-sm">
              <div className="font-bold text-lg">Level up your sales</div>
              <div className="text-sm text-white/80 mt-2">
                An any way to manage sales with care and precision.
              </div>
              <div className="mt-4">
                <button className="bg-prodifyOrange text-white px-4 py-2 rounded-md font-bold">
                  Upgrade to Premium
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
