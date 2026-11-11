"use client";

import { useState, useTransition } from "react";
import {
  upsertActiveCostConfig,
  type CostConfigInput,
} from "@/actions/masters/costs";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { IntegerInput, MoneyInput } from "@/components/ui/number-input";
import { formatRupiah } from "@/lib/utils";

export type CostRow = {
  id: string;
  name: string;
  isActive: boolean;
  isHppEnabled: boolean;
  globalSolarPrice: number;
  globalTirePrice: number;
  tireLifespanDays: number;
  defaultMaintenanceBudget: number;
  defaultCicilan: number;
  defaultDepreciation: number;
  defaultMovingCost: number;
  estimatedOpsDaysPerMonth: number;
};

export function CostsClient({
  config,
  canWrite,
}: {
  config: CostRow | null;
  canWrite: boolean;
}) {
  const [form, setForm] = useState<CostConfigInput>({
    name: config?.name ?? "Default",
    isActive: config?.isActive ?? true,
    isHppEnabled: config?.isHppEnabled ?? false,
    globalSolarPrice: config?.globalSolarPrice ?? 15000,
    globalTirePrice: config?.globalTirePrice ?? 12000000,
    tireLifespanDays: config?.tireLifespanDays ?? 180,
    defaultMaintenanceBudget: config?.defaultMaintenanceBudget ?? 5000000,
    defaultCicilan: config?.defaultCicilan ?? 15000000,
    defaultDepreciation: config?.defaultDepreciation ?? 250000,
    defaultMovingCost: config?.defaultMovingCost ?? 2000000,
    estimatedOpsDaysPerMonth: config?.estimatedOpsDaysPerMonth ?? 25,
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tirePerDay =
    form.tireLifespanDays > 0 ? form.globalTirePrice / form.tireLifespanDays : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setError(null);
    setOk(null);
    startTransition(async () => {
      const res = await upsertActiveCostConfig(form, config?.id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOk("Konfigurasi HPP tersimpan.");
    });
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-neutral-900">HPP Settings</h1>
        <p className="text-sm text-neutral-500">
          Variabel biaya (solar, ban, maintenance, cicilan, depresiasi, moving)
          untuk perhitungan HPP real, mis. evaluasi tahunan.
        </p>
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Default: mesin HPP teoritis <b>MATI</b>. Keuangan memakai basis kas + biaya
          aktual DO / stok / breakdown. Nyalakan toggle di bawah hanya jika ingin
          alokasi ban / cicilan / depresiasi teoritis.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="grid max-w-3xl gap-4 rounded-xl border border-neutral-200 bg-white p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Label>Nama Config</Label>
          <Input
            required
            disabled={!canWrite}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="sm:col-span-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <Label>Mesin HPP Teoritis</Label>
          <Select
            disabled={!canWrite}
            value={form.isHppEnabled ? "1" : "0"}
            onChange={(e) =>
              setForm({ ...form, isHppEnabled: e.target.value === "1" })
            }
          >
            <option value="0">OFF (default) — cash basis saja</option>
            <option value="1">ON — pakai alokasi teoritis di bawah</option>
          </Select>
          <p className="mt-1 text-[11px] text-neutral-500">
            OFF = Buku Harian / Kas tidak memakai angka ban·cicilan·depresiasi
            teoritis. ON = cadangan untuk evaluasi tahunan.
          </p>
        </div>

        <div>
          <Label>Harga Solar (Rp/liter)</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.globalSolarPrice}
            onChange={(globalSolarPrice) =>
              setForm({ ...form, globalSolarPrice })
            }
          />
        </div>
        <div>
          <Label>Harga Ban (set)</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.globalTirePrice}
            onChange={(globalTirePrice) => setForm({ ...form, globalTirePrice })}
          />
        </div>
        <div>
          <Label>Umur Ban (hari)</Label>
          <IntegerInput
            disabled={!canWrite}
            value={form.tireLifespanDays}
            onChange={(tireLifespanDays) =>
              setForm({ ...form, tireLifespanDays })
            }
          />
          <p className="mt-1 text-[11px] text-neutral-400">
            Alokasi harian ≈ {formatRupiah(tirePerDay)}
          </p>
        </div>
        <div>
          <Label>Hari Operasi / Bulan</Label>
          <IntegerInput
            disabled={!canWrite}
            value={form.estimatedOpsDaysPerMonth}
            onChange={(estimatedOpsDaysPerMonth) =>
              setForm({ ...form, estimatedOpsDaysPerMonth })
            }
          />
        </div>
        <div>
          <Label>Budget Maintenance / bln</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.defaultMaintenanceBudget}
            onChange={(defaultMaintenanceBudget) =>
              setForm({ ...form, defaultMaintenanceBudget })
            }
          />
        </div>
        <div>
          <Label>Cicilan Default / bln</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.defaultCicilan}
            onChange={(defaultCicilan) => setForm({ ...form, defaultCicilan })}
          />
        </div>
        <div>
          <Label>Depresiasi Default / hari</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.defaultDepreciation}
            onChange={(defaultDepreciation) =>
              setForm({ ...form, defaultDepreciation })
            }
          />
        </div>
        <div>
          <Label>Moving Cost / periode</Label>
          <MoneyInput
            disabled={!canWrite}
            value={form.defaultMovingCost}
            onChange={(defaultMovingCost) =>
              setForm({ ...form, defaultMovingCost })
            }
          />
        </div>
        <div>
          <Label>Aktif?</Label>
          <Select
            disabled={!canWrite}
            value={form.isActive ? "1" : "0"}
            onChange={(e) =>
              setForm({ ...form, isActive: e.target.value === "1" })
            }
          >
            <option value="1">Ya — dipakai kalkulasi</option>
            <option value="0">Tidak</option>
          </Select>
        </div>

        {error && <p className="sm:col-span-2 text-sm text-neutral-900">{error}</p>}
        {ok && <p className="sm:col-span-2 text-sm text-neutral-600">{ok}</p>}

        {canWrite && (
          <div className="sm:col-span-2 flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan Konfigurasi"}
            </Button>
          </div>
        )}
        {!canWrite && (
          <p className="sm:col-span-2 text-xs text-neutral-400">
            Read-only untuk role Anda. Edit: FINANCE / OWNER / ADMIN.
          </p>
        )}
      </form>
    </div>
  );
}
