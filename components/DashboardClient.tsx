"use client";
import React, { useEffect, useState } from "react";
import ProdifySidebar from "@/components/ProdifySidebar";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import Button from "@/components/ui/Button";

const COLORS = ["#6F4ACF", "#0DAA00", "#FF6600"];

type Order = {
  id: string;
  created_at: string;
  customers?: { name?: string } | null;
  total_amount?: number;
  status?: string;
};

export default function DashboardClient() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [statusSummary, setStatusSummary] = useState<any>(null);

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
      .then((json) => setStatusSummary(json))
      .catch(() => setStatusSummary(null));
  }, []);

  function fmtBRL(n?: number) {
    return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  }

  const pieData = statusSummary
    ? Object.entries(statusSummary).map(([k, v]: any) => ({ name: k, value: v.count ?? v }))
    : [{ name: "A", value: 58 }, { name: "B", value: 20 }, { name: "C", value: 22 }];

  return (
    <div className="min-h-screen flex bg-gray-50">
      <ProdifySidebar />

      <main className="flex-1 py-6">
        <div className="container-max">
          {/* Topbar */}
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-2xl font-semibold">Sales Admin</h2>
            <div className="flex-1" />
            <div className="w-full max-w-md">
              <input className="w-full p-2 rounded-md border border-gray-200" placeholder="Prodify Finder" />
            </div>
            <Button className="ml-3" variant="primary">Add new product</Button>
          </div>

          {/* Top cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="lg:col-span-2 card">
              <div className="text-prodifyOrange font-bold">Update</div>
              <h3 className="mt-2 text-xl font-bold">
                This Week&apos;s Sales Revenue <br />
                <span className="text-prodifyGreen">Increased by 40%</span>
              </h3>
              <div className="mt-4 text-gray-500">Monitor Stats &gt;</div>
            </div>

            <div className="card">
              <div className="font-semibold">Total Earnings</div>
              <div className="text-2xl font-bold mt-2">R$ {fmtBRL(stats?.stats?.totalRevenue)}</div>
              <div className="text-sm text-gray-500 mt-2">Up 35% Month-over-Month</div>
            </div>

            <div className="card">
              <div className="font-semibold">Net Return</div>
              <div className="text-2xl font-bold mt-2">R$ {fmtBRL((stats?.stats?.totalRevenue || 0) * 0.2)}</div>
              <div className="text-sm text-gray-500 mt-2">Down 15% Month-over-Month</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="card">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-bold text-lg">Transaction</div>
                  <Button variant="outline" size="sm">View all</Button>
                </div>

                {orders.length === 0 ? (
                  <div className="text-gray-500 py-6">Nenhuma transação encontrada.</div>
                ) : (
                  <ul className="space-y-3">
                    {orders.map((o) => (
                      <li key={o.id} className="flex justify-between items-center p-3 rounded hover:bg-gray-50">
                        <div>
                          <div className="font-semibold">{o.customers?.name ?? "-"}</div>
                          <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleDateString()}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">R$ {fmtBRL(o.total_amount)}</div>
                          <div className={`text-xs mt-1 ${o.status === "new" ? "text-prodifyGreen" : "text-prodifyOrange"}`}>{o.status}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card">
                  <div className="font-semibold">Revenue</div>
                  <div className="text-2xl font-bold mt-2">R$ {fmtBRL(stats?.stats?.totalRevenue)}</div>
                  <div className="h-36 mt-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={(stats?.daily ?? []).map((d: any) => ({ date: d.date, revenue: d.revenue }))}>
                        <XAxis dataKey="date" hide />
                        <YAxis hide />
                        <Tooltip formatter={(value: any) => [`R$ ${fmtBRL(value)}`, "Receita"]} />
                        <Line type="monotone" dataKey="revenue" stroke="#3B246B" strokeWidth={3} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="card">
                  <div className="font-semibold">Sales Report</div>
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex justify-between text-sm"><span>Product Launched</span><span className="font-bold">233</span></div>
                      <div className="h-2 bg-gray-100 rounded mt-2"><div className="h-2 bg-prodifyPurple rounded" style={{ width: "70%" }} /></div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm"><span>Ongoing product</span><span className="font-bold">180</span></div>
                      <div className="h-2 bg-gray-100 rounded mt-2"><div className="h-2 bg-prodifyOrange rounded" style={{ width: "50%" }} /></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="card">
                <div className="flex justify-between items-center">
                  <div className="font-semibold">Total view performance</div>
                </div>
                <div className="h-48 mt-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" innerRadius={40} outerRadius={70} paddingAngle={4}>
                        {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center font-bold mt-2">Total count<br/>496K</div>
              </div>

              <div className="bg-prodifyPurple text-white p-4 rounded-lg shadow">
                <div className="font-bold text-lg">Level up your sales</div>
                <div className="text-sm text-white/80 mt-2">An any way to manage sales with care and precision.</div>
                <div className="mt-4">
                  <Button variant="primary">Upgrade to Premium</Button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
