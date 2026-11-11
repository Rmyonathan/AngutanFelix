"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  createBreakdown,
  deleteBreakdown,
  updateBreakdown,
  type BreakdownInput,
} from "@/actions/breakdown";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DecimalInput, MoneyInput } from "@/components/ui/number-input";
import { FormDialog } from "@/components/masters/form-dialog";
import { parseIdNumber } from "@/lib/numbers";
import { formatNumber, formatRupiah } from "@/lib/utils";
import type { BreakdownMonthlyStats } from "@/lib/breakdown/stats";
import { isBreakdownActive } from "@/lib/breakdown/active";
import { APP_TIMEZONE, toWibDateTimeLocal } from "@/lib/dates";

export type BreakdownRow = {
  id: string;
  unitId: string;
  unitNumber: string;
  date: string;
  issueDescription: string;
  startTime: string;
  endTime: string | null;
  downtimeHours: number | null;
  maintenanceCost: number;
  partsUsed: { name: string; qty: number; totalPrice: number }[];
};

type UnitOption = { id: string; unitNumber: string };

type PartOption = {
  id: string;
  name: string;
  stock: number;
  averagePrice: number;
};

type PartLine = { partId: string; qty: string };

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return toWibDateTimeLocal(d);
}

function emptyForm(unitId = ""): Omit<BreakdownInput, "parts"> {
  const start = toWibDateTimeLocal(new Date());
  return {
    unitId,
    date: start.slice(0, 10),
    issueDescription: "",
    startTime: start,
    endTime: "",
    downtimeHours: "",
    maintenanceCost: 0,
  };
}

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIMEZONE,
  });
}

export function BreakdownClient({
  rows,
  units,
  parts,
  stats,
  canWrite,
  filterUnitId,
  filterMonth,
}: {
  rows: BreakdownRow[];
  units: UnitOption[];
  parts: PartOption[];
  stats: BreakdownMonthlyStats;
  canWrite: boolean;
  filterUnitId: string;
  filterMonth: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [partLines, setPartLines] = useState<PartLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = editingId ? "Edit Breakdown" : "Catat Breakdown";

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const base = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      opts.push({
        value,
        label: d.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
      });
    }
    return opts;
  }, []);

  function setFilter(next: { unitId?: string; month?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const unitId = next.unitId ?? filterUnitId;
    const month = next.month ?? filterMonth;
    if (unitId) params.set("unitId", unitId);
    else params.delete("unitId");
    if (month) params.set("month", month);
    else params.delete("month");
    router.push(`/breakdown?${params.toString()}`);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm(filterUnitId || units[0]?.id || ""));
    setPartLines([]);
    setError(null);
    setOpen(true);
  }

  function openEdit(row: BreakdownRow) {
    setEditingId(row.id);
    setForm({
      unitId: row.unitId,
      date: row.date,
      issueDescription: row.issueDescription,
      startTime: toDatetimeLocal(row.startTime),
      endTime: row.endTime ? toDatetimeLocal(row.endTime) : "",
      downtimeHours: row.downtimeHours ?? ("" as const),
      maintenanceCost: row.maintenanceCost,
    });
    setPartLines([]);
    setError(null);
    setOpen(true);
  }

  function addPartLine() {
    const first = parts.find((p) => p.stock > 0) ?? parts[0];
    if (!first) return;
    setPartLines((prev) => [...prev, { partId: first.id, qty: "1" }]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const partsPayload = editingId
        ? []
        : partLines
            .map((l) => ({
              partId: l.partId,
              qty: parseIdNumber(l.qty),
            }))
            .filter((l) => l.partId && l.qty > 0);

      const payload: BreakdownInput = {
        ...form,
        endTime: form.endTime || null,
        downtimeHours:
          form.downtimeHours === "" || form.downtimeHours == null
            ? null
            : form.downtimeHours,
        parts: partsPayload,
      };
      const res = editingId
        ? await updateBreakdown(editingId, payload)
        : await createBreakdown(payload);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  function onDelete(id: string) {
    if (!confirm("Hapus histori breakdown ini?")) return;
    startTransition(async () => {
      const res = await deleteBreakdown(id);
      if (!res.success) alert(res.error);
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">
            Riwayat Breakdown
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Downtime, pakai barang gudang, dan biaya bayar luar (kas) per unit.
          </p>
          <p className="mt-1 text-xs text-neutral-400">{stats.periodLabel}</p>
        </div>
        {canWrite && (
          <Button type="button" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Catat Breakdown
          </Button>
        )}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title="Downtime bulan ini"
          value={`${formatNumber(stats.totalDowntimeHours, 1)} jam`}
          sub={`${stats.openCount} masih open`}
        />
        <Kpi
          title="Biaya maintenance"
          value={formatRupiah(stats.totalMaintenanceCost)}
        />
        <Kpi
          title="Availability"
          value={`${formatNumber(stats.availabilityPercent, 1)}%`}
          sub={`${formatNumber(stats.availableHours, 0)} jam kapasitas`}
        />
        <Kpi
          title="Event"
          value={String(stats.openCount + stats.closedCount)}
          sub={`${stats.closedCount} selesai · ${stats.openCount} open`}
          muted
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[160px]">
          <Label>Bulan</Label>
          <Select
            value={filterMonth}
            onChange={(e) => setFilter({ month: e.target.value })}
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[160px]">
          <Label>Unit</Label>
          <Select
            value={filterUnitId}
            onChange={(e) => setFilter({ unitId: e.target.value })}
          >
            <option value="">Semua unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitNumber}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <section className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2">Tanggal</th>
              <th className="px-4 py-2">Unit</th>
              <th className="px-4 py-2">Masalah</th>
              <th className="px-4 py-2">Mulai</th>
              <th className="px-4 py-2">Selesai</th>
              <th className="px-4 py-2">Downtime</th>
              <th className="px-4 py-2">Stok dipakai</th>
              <th className="px-4 py-2">Biaya luar</th>
              {canWrite && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canWrite ? 9 : 8}
                  className="px-4 py-10 text-center text-neutral-400"
                >
                  Belum ada histori breakdown untuk filter ini.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-neutral-50 hover:bg-neutral-50"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">{row.date}</td>
                  <td className="px-4 py-2.5 font-medium">{row.unitNumber}</td>
                  <td className="max-w-[200px] px-4 py-2.5">
                    <span className="line-clamp-2">{row.issueDescription}</span>
                    {isBreakdownActive(row) && (
                      <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wide text-red-600">
                        🔴 Sedang breakdown
                        {row.endTime ? " · s/d " + formatClock(row.endTime) : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-neutral-600">
                    {formatClock(row.startTime)}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-neutral-600">
                    {formatClock(row.endTime)}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {row.downtimeHours != null
                      ? `${formatNumber(row.downtimeHours, 1)} jam`
                      : "—"}
                  </td>
                  <td className="max-w-[160px] px-4 py-2.5 text-xs text-neutral-600">
                    {row.partsUsed.length === 0
                      ? "—"
                      : row.partsUsed
                          .map((p) => `${p.name} × ${p.qty}`)
                          .join(", ")}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {formatRupiah(row.maintenanceCost)}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => openEdit(row)}
                        className="mr-2 inline-flex text-neutral-500 hover:text-neutral-900"
                        aria-label="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onDelete(row.id)}
                        className="inline-flex text-neutral-500 hover:text-neutral-900"
                        aria-label="Hapus"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <FormDialog open={open} title={title} onClose={() => setOpen(false)} wide>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Unit</Label>
            <Select
              required
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
            >
              <option value="">Pilih unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNumber}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Tanggal</Label>
            <Input
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <Label>Biaya luar / kas (Rp)</Label>
            <MoneyInput
              value={form.maintenanceCost}
              onChange={(maintenanceCost) =>
                setForm({ ...form, maintenanceCost })
              }
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              Bayar bengkel / jasa luar → kas BIAYA_BREAKDOWN. Barang dari gudang
              pilih di bawah (bukan kas).
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Masalah</Label>
            <Input
              required
              placeholder="Contoh: Ban pecah / Radiator bocor"
              value={form.issueDescription}
              onChange={(e) =>
                setForm({ ...form, issueDescription: e.target.value })
              }
            />
          </div>
          <div>
            <Label>Mulai</Label>
            <Input
              type="datetime-local"
              required
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
            />
          </div>
          <div>
            <Label>Selesai (kosong = masih open)</Label>
            <Input
              type="datetime-local"
              value={form.endTime ?? ""}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Downtime jam (opsional — auto dari mulai/selesai)</Label>
            <DecimalInput
              decimals={1}
              placeholder="Auto"
              value={
                form.downtimeHours === "" || form.downtimeHours == null
                  ? 0
                  : form.downtimeHours
              }
              onChange={(hours) =>
                setForm({
                  ...form,
                  downtimeHours: hours === 0 ? "" : hours,
                })
              }
            />
          </div>

          {!editingId && (
            <div className="sm:col-span-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-neutral-800">
                    Pakai dari stok gudang
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    Stok berkurang · tidak mengurangi kas (sudah dibayar saat beli)
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!parts.length}
                  onClick={addPartLine}
                >
                  + Barang
                </Button>
              </div>
              {!parts.length && (
                <p className="text-xs text-amber-700">
                  Belum ada barang di gudang. Tambah di Breakdown → Stok.
                </p>
              )}
              {partLines.map((line, idx) => {
                const part = parts.find((p) => p.id === line.partId);
                return (
                  <div
                    key={idx}
                    className="grid gap-2 sm:grid-cols-[1fr_100px_auto]"
                  >
                    <Select
                      value={line.partId}
                      onChange={(e) => {
                        const next = [...partLines];
                        next[idx] = { ...next[idx], partId: e.target.value };
                        setPartLines(next);
                      }}
                    >
                      {parts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — stok {p.stock}
                        </option>
                      ))}
                    </Select>
                    <Input
                      inputMode="decimal"
                      placeholder="Qty"
                      value={line.qty}
                      onChange={(e) => {
                        const next = [...partLines];
                        next[idx] = { ...next[idx], qty: e.target.value };
                        setPartLines(next);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPartLines(partLines.filter((_, i) => i !== idx))
                      }
                    >
                      Hapus
                    </Button>
                    {part && (
                      <p className="text-[11px] text-neutral-500 sm:col-span-3">
                        ≈ {formatRupiah(parseIdNumber(line.qty) * part.averagePrice)}{" "}
                        (harga rata-rata)
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {editingId && (
            <p className="text-xs text-neutral-500 sm:col-span-2">
              Stok yang sudah dipakai tidak diubah lewat edit. Hapus breakdown
              untuk mengembalikan stok, lalu catat ulang bila perlu.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600 sm:col-span-2">{error}</p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}

function Kpi({
  title,
  value,
  sub,
  muted,
}: {
  title: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-neutral-200 p-4 ${
        muted ? "bg-neutral-50" : "bg-white"
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums text-neutral-900">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-neutral-400">{sub}</p>}
    </div>
  );
}
