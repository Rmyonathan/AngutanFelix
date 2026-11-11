"use client";

import { useState, useTransition } from "react";
import { PartCategory } from "@prisma/client";
import { createPart, restockPart } from "@/actions/inventory";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DecimalField, MoneyField } from "@/components/ui/number-input";
import { FormDialog } from "@/components/masters/form-dialog";
import { parseIdNumber } from "@/lib/numbers";
import { formatRupiah } from "@/lib/utils";
import { todayDateOnly } from "@/lib/dates";

export type InventoryPartRow = {
  id: string;
  name: string;
  category: PartCategory;
  stock: number;
  averagePrice: number;
};

export type InventoryTxRow = {
  id: string;
  date: string;
  type: "IN" | "OUT";
  qty: number;
  totalPrice: number;
  partName: string;
  partCategory: PartCategory;
  unitNumber: string | null;
  notes: string | null;
};

const CATEGORY_OPTIONS: { value: PartCategory; label: string }[] = [
  { value: PartCategory.BAN, label: "Ban" },
  { value: PartCategory.OLI, label: "Oli" },
  { value: PartCategory.SPAREPART, label: "Sparepart" },
  { value: PartCategory.LAINNYA, label: "Lainnya" },
];

function categoryLabel(c: PartCategory) {
  return CATEGORY_OPTIONS.find((x) => x.value === c)?.label ?? c;
}

type Tab = "stock" | "history";

export function InventoryClient({
  parts,
  transactions,
  canWrite,
}: {
  parts: InventoryPartRow[];
  transactions: InventoryTxRow[];
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<Tab>("stock");
  const [dialog, setDialog] = useState<"part" | "buy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [partName, setPartName] = useState("");
  const [partCategory, setPartCategory] = useState<PartCategory>(
    PartCategory.BAN
  );

  const [buyPartId, setBuyPartId] = useState(parts[0]?.id ?? "");
  const [buyDate, setBuyDate] = useState(todayDateOnly());
  const [buyQty, setBuyQty] = useState("");
  const [buyTotal, setBuyTotal] = useState("");
  const [buyNotes, setBuyNotes] = useState("");

  function open(d: "part" | "buy") {
    setError(null);
    setOk(null);
    if (d === "buy" && !parts.length) {
      setError("Tambah barang dulu sebelum beli stok.");
      return;
    }
    if (d === "buy") {
      const id =
        buyPartId && parts.some((p) => p.id === buyPartId)
          ? buyPartId
          : (parts[0]?.id ?? "");
      setBuyPartId(id);
    }
    setDialog(d);
  }

  function submitPart(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setError(null);
    startTransition(async () => {
      const res = await createPart({ name: partName, category: partCategory });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOk("Barang baru ditambahkan.");
      setPartName("");
      setDialog(null);
    });
  }

  function submitBuy(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setError(null);
    startTransition(async () => {
      const res = await restockPart({
        partId: buyPartId || parts[0]?.id || "",
        date: buyDate,
        qty: parseIdNumber(buyQty),
        totalPrice: parseIdNumber(buyTotal),
        notes: buyNotes || null,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOk("Stok bertambah · kas keluar BIAYA_STOK tercatat di Buku Harian.");
      setBuyQty("");
      setBuyTotal("");
      setBuyNotes("");
      setDialog(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Stok Gudang</h1>
          <p className="text-sm text-neutral-500">
            Beli barang = kas keluar. Pakai barang saat{" "}
            <a href="/breakdown" className="underline underline-offset-2">
              Catat Breakdown
            </a>
            .
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => open("part")}>
              + Barang Baru
            </Button>
            <Button type="button" onClick={() => open("buy")}>
              🛒 Beli Stok (Kas Keluar)
            </Button>
          </div>
        )}
      </div>

      {ok && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {ok}
        </p>
      )}
      {error && !dialog && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-1 border-b border-neutral-200">
        {(
          [
            ["stock", "Stok Saat Ini"],
            ["history", "Riwayat Transaksi"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === key
                ? "border-b-2 border-neutral-900 text-neutral-900"
                : "text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stock" ? (
        <section className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2">Nama Barang</th>
                <th className="px-4 py-2">Kategori</th>
                <th className="px-4 py-2">Stok</th>
                <th className="px-4 py-2">Harga Rata-rata</th>
              </tr>
            </thead>
            <tbody>
              {parts.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-neutral-400"
                  >
                    Belum ada barang. Tambah barang lalu beli stok.
                  </td>
                </tr>
              ) : (
                parts.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-neutral-50 ${
                      p.stock < 5 ? "bg-amber-50" : "hover:bg-neutral-50"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className="px-4 py-2.5 text-neutral-600">
                      {categoryLabel(p.category)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {p.stock}
                      {p.stock < 5 && (
                        <span className="ml-2 text-[10px] font-medium uppercase text-amber-700">
                          rendah
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatRupiah(p.averagePrice)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2">Tanggal</th>
                <th className="px-4 py-2">Jenis</th>
                <th className="px-4 py-2">Barang</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Unit</th>
                <th className="px-4 py-2">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-neutral-400"
                  >
                    Belum ada transaksi stok.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => {
                  const isIn = t.type === "IN";
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-neutral-50 hover:bg-neutral-50"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-xs font-semibold ${
                            isIn ? "text-emerald-700" : "text-red-700"
                          }`}
                        >
                          {isIn ? "IN · Beli" : "OUT · Breakdown"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {t.partName}
                        <span className="mt-0.5 block text-xs text-neutral-400">
                          {categoryLabel(t.partCategory)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{t.qty}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {formatRupiah(t.totalPrice)}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-500">
                        {t.unitNumber ?? "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-neutral-400">
                        {t.notes ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      )}

      <FormDialog
        open={dialog === "part"}
        title="Barang Baru"
        onClose={() => setDialog(null)}
      >
        <form onSubmit={submitPart} className="grid gap-3">
          <div>
            <Label>Nama</Label>
            <Input
              required
              value={partName}
              onChange={(e) => setPartName(e.target.value)}
              placeholder="Contoh: Ban Bridgestone 12R22.5"
            />
          </div>
          <div>
            <Label>Kategori</Label>
            <Select
              value={partCategory}
              onChange={(e) => setPartCategory(e.target.value as PartCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </FormDialog>

      <FormDialog
        open={dialog === "buy"}
        title="Beli Stok (Kas Keluar)"
        onClose={() => setDialog(null)}
      >
        <form onSubmit={submitBuy} className="grid gap-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Total harga langsung menjadi <b>pengeluaran kas</b> kategori{" "}
            <b>BIAYA_STOK</b> di Buku Harian / Kas.
          </p>
          <div>
            <Label>Barang</Label>
            <Select
              required
              value={buyPartId}
              onChange={(e) => setBuyPartId(e.target.value)}
            >
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({categoryLabel(p.category)})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Tanggal</Label>
            <Input
              type="date"
              required
              value={buyDate}
              onChange={(e) => setBuyDate(e.target.value)}
            />
          </div>
          <div>
            <Label>Qty</Label>
            <DecimalField
              required
              value={buyQty}
              onChange={setBuyQty}
              placeholder="10"
            />
          </div>
          <div>
            <Label>Total Harga (Rp)</Label>
            <MoneyField
              required
              value={buyTotal}
              onChange={setBuyTotal}
              placeholder="0"
            />
          </div>
          <div>
            <Label>Catatan</Label>
            <Input
              value={buyNotes}
              onChange={(e) => setBuyNotes(e.target.value)}
              placeholder="Opsional — supplier / nota"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Batal
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Beli & Catat Kas"}
            </Button>
          </div>
        </form>
      </FormDialog>
    </div>
  );
}
