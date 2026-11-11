"use server";

import { revalidatePath } from "next/cache";
import {
  AuditAction,
  InvTransactionType,
  JournalCategory,
  JournalEntryType,
  PartCategory,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { parseDateOnly, tryParseDateOnly } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/types";

const partSchema = z.object({
  name: z.string().min(1, "Nama barang wajib"),
  category: z.nativeEnum(PartCategory).default(PartCategory.LAINNYA),
});

const restockSchema = z.object({
  partId: z.string().min(1, "Barang wajib"),
  date: z.string().min(1, "Tanggal wajib"),
  qty: z.coerce.number().positive("Qty harus > 0"),
  totalPrice: z.coerce.number().positive("Total harga harus > 0"),
  notes: z.string().optional().nullable(),
});

const usePartSchema = z.object({
  partId: z.string().min(1, "Barang wajib"),
  date: z.string().min(1, "Tanggal wajib"),
  qty: z.coerce.number().positive("Qty harus > 0"),
  unitId: z.string().min(1, "Unit wajib untuk alokasi servis"),
  notes: z.string().optional().nullable(),
});

export type PartInput = z.infer<typeof partSchema>;
export type RestockInput = z.infer<typeof restockSchema>;
export type UsePartInput = z.infer<typeof usePartSchema>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assertInventoryWrite() {
  const session = await requireSession();
  if (
    !hasPermission(session.user.role, "inventory:write") &&
    !hasPermission(session.user.role, "*")
  ) {
    throw new Error("Forbidden: butuh hak akses Stok & Servis");
  }
  return session;
}

function revalidateInventoryPaths() {
  revalidatePath("/inventory");
  revalidatePath("/finance");
  revalidatePath("/finance/buku-harian");
  revalidatePath("/finance/kas");
  revalidatePath("/finance/profitabilitas");
  revalidatePath("/dashboard");
}

function categoryLabel(c: PartCategory): string {
  switch (c) {
    case PartCategory.BAN:
      return "BAN";
    case PartCategory.OLI:
      return "OLI";
    case PartCategory.SPAREPART:
      return "SPAREPART";
    default:
      return "LAINNYA";
  }
}

/** Weighted average after restock (must stay non-exported — "use server" only allows async exports) */
function nextAveragePrice(
  stock: number,
  averagePrice: number,
  qty: number,
  totalPrice: number
): number {
  const newStock = stock + qty;
  if (newStock <= 0) return 0;
  if (stock <= 0) return totalPrice / qty;
  return (stock * averagePrice + totalPrice) / newStock;
}

export async function createPart(
  raw: PartInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertInventoryWrite();
    const parsed = partSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid",
      };
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.masterPart.create({
        data: {
          name: parsed.data.name.trim(),
          category: parsed.data.category,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: AuditAction.CREATE,
          tableName: "MasterPart",
          recordId: created.id,
          newData: toJson(created),
        },
      });
      return created;
    });

    revalidateInventoryPaths();
    return { success: true, data: { id: row.id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal tambah barang",
    };
  }
}

/**
 * Beli stok → stock ↑, averagePrice recalculated, InventoryTransaction IN,
 * and CASH_OUT journal BIAYA_STOK (kas keluar).
 */
export async function restockPart(
  raw: RestockInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertInventoryWrite();
    const parsed = restockSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid",
      };
    }

    const d = parsed.data;
    const date = tryParseDateOnly(d.date) ?? parseDateOnly(d.date);

    const part = await prisma.masterPart.findUnique({ where: { id: d.partId } });
    if (!part) return { success: false, error: "Barang tidak ditemukan" };

    const avg = nextAveragePrice(
      part.stock,
      part.averagePrice,
      d.qty,
      d.totalPrice
    );
    const newStock = part.stock + d.qty;
    const desc = `Beli Stok: ${categoryLabel(part.category)} ${part.name} — ${d.qty} pcs`;

    const row = await prisma.$transaction(async (tx) => {
      const updatedPart = await tx.masterPart.update({
        where: { id: part.id },
        data: { stock: newStock, averagePrice: avg },
      });

      const txRow = await tx.inventoryTransaction.create({
        data: {
          partId: part.id,
          type: InvTransactionType.IN,
          date,
          qty: d.qty,
          totalPrice: d.totalPrice,
          notes: d.notes?.trim() || null,
        },
      });

      const journal = await tx.hppJournalEntry.create({
        data: {
          date,
          entryType: JournalEntryType.CASH_OUT,
          category: JournalCategory.BIAYA_STOK,
          description: desc,
          amount: d.totalPrice,
          notes: `[inventory:${txRow.id}]${d.notes?.trim() ? ` ${d.notes.trim()}` : ""}`,
          createdById: session.user.id,
          /// Kas keluar saat beli; HPP unit baru saat pakai (OUT)
          kasOnly: true,
        },
      });

      await tx.auditLog.createMany({
        data: [
          {
            userId: session.user.id,
            action: AuditAction.UPDATE,
            tableName: "MasterPart",
            recordId: part.id,
            oldData: toJson(part),
            newData: toJson(updatedPart),
          },
          {
            userId: session.user.id,
            action: AuditAction.CREATE,
            tableName: "InventoryTransaction",
            recordId: txRow.id,
            newData: toJson(txRow),
          },
          {
            userId: session.user.id,
            action: AuditAction.CREATE,
            tableName: "HppJournalEntry",
            recordId: journal.id,
            newData: toJson(journal),
          },
        ],
      });

      return txRow;
    });

    revalidateInventoryPaths();
    return { success: true, data: { id: row.id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal beli stok",
    };
  }
}

/**
 * Pakai stok ke unit → stock ↓, InventoryTransaction OUT.
 * No cash journal (already paid on restock). Cost attributed to unit for P&L.
 */
export async function usePart(
  raw: UsePartInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertInventoryWrite();
    const parsed = usePartSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid",
      };
    }

    const d = parsed.data;
    const date = tryParseDateOnly(d.date) ?? parseDateOnly(d.date);

    const [part, unit] = await Promise.all([
      prisma.masterPart.findUnique({ where: { id: d.partId } }),
      prisma.masterUnit.findUnique({ where: { id: d.unitId } }),
    ]);
    if (!part) return { success: false, error: "Barang tidak ditemukan" };
    if (!unit) return { success: false, error: "Unit tidak ditemukan" };
    if (d.qty > part.stock) {
      return {
        success: false,
        error: `Stok tidak cukup (tersedia ${part.stock})`,
      };
    }

    const totalPrice = d.qty * part.averagePrice;
    const newStock = part.stock - d.qty;

    const row = await prisma.$transaction(async (tx) => {
      const updatedPart = await tx.masterPart.update({
        where: { id: part.id },
        data: { stock: newStock },
      });

      const txRow = await tx.inventoryTransaction.create({
        data: {
          partId: part.id,
          type: InvTransactionType.OUT,
          date,
          qty: d.qty,
          totalPrice,
          unitId: unit.id,
          notes: d.notes?.trim() || null,
        },
      });

      await tx.auditLog.createMany({
        data: [
          {
            userId: session.user.id,
            action: AuditAction.UPDATE,
            tableName: "MasterPart",
            recordId: part.id,
            oldData: toJson(part),
            newData: toJson(updatedPart),
          },
          {
            userId: session.user.id,
            action: AuditAction.CREATE,
            tableName: "InventoryTransaction",
            recordId: txRow.id,
            newData: toJson(txRow),
          },
        ],
      });

      return txRow;
    });

    revalidateInventoryPaths();
    return { success: true, data: { id: row.id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal pakai stok",
    };
  }
}
