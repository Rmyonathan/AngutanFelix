"use server";

import { revalidatePath } from "next/cache";
import {
  AuditAction,
  InvTransactionType,
  JournalCategory,
  JournalEntryType,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { parseDateOnly, parseWibDateTime } from "@/lib/dates";
import { syncUnitBreakdownStatus } from "@/lib/breakdown/unit-status";
import type { ActionResult } from "@/lib/actions/types";

const partUseSchema = z.object({
  partId: z.string().min(1),
  qty: z.coerce.number().positive("Qty stok harus > 0"),
});

const breakdownSchema = z.object({
  unitId: z.string().min(1, "Unit wajib"),
  date: z.string().min(1, "Tanggal wajib"),
  issueDescription: z.string().min(1, "Masalah wajib"),
  startTime: z.string().min(1, "Waktu mulai wajib"),
  endTime: z.string().optional().nullable(),
  downtimeHours: z.union([z.coerce.number(), z.literal("")]).optional().nullable(),
  /// Biaya bayar luar (kas). Barang gudang lewat `parts`.
  maintenanceCost: z.coerce.number().min(0).default(0),
  parts: z.array(partUseSchema).optional().default([]),
});

export type BreakdownInput = z.infer<typeof breakdownSchema>;

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function assertBreakdownWrite() {
  const session = await requireSession();
  if (
    !hasPermission(session.user.role, "breakdown:write") &&
    !hasPermission(session.user.role, "*")
  ) {
    throw new Error("Forbidden: ADMIN/OWNER only");
  }
  return session;
}

const parseDateTime = parseWibDateTime;

function calcDowntimeHours(
  start: Date,
  end: Date | null,
  manual: number | null | undefined
): number | null {
  if (manual != null && Number.isFinite(manual) && manual >= 0) return manual;
  if (!end) return null;
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(0, Math.round(hours * 100) / 100);
}

async function syncUnitStatus(tx: Prisma.TransactionClient, unitId: string) {
  await syncUnitBreakdownStatus(tx, [unitId]);
}

function mapData(raw: BreakdownInput) {
  const startTime = parseDateTime(raw.startTime);
  const endTime =
    raw.endTime && String(raw.endTime).trim() !== ""
      ? parseDateTime(String(raw.endTime))
      : null;

  if (endTime && endTime.getTime() < startTime.getTime()) {
    throw new Error("Waktu selesai harus setelah mulai");
  }

  const manual =
    raw.downtimeHours === "" || raw.downtimeHours == null
      ? null
      : Number(raw.downtimeHours);

  return {
    unitId: raw.unitId,
    date: parseDateOnly(raw.date),
    issueDescription: raw.issueDescription.trim(),
    startTime,
    endTime,
    downtimeHours: calcDowntimeHours(startTime, endTime, manual),
    maintenanceCost: raw.maintenanceCost ?? 0,
  };
}

function breakdownJournalNotes(id: string, issue: string) {
  return `[breakdown:${id}] ${issue}`;
}

function journalDescription(issue: string, unitNumber: string) {
  return `${issue} — Unit ${unitNumber}`;
}

/** Consume warehouse parts for a breakdown (no cash — already paid on restock) */
async function consumePartsForBreakdown(
  tx: Prisma.TransactionClient,
  opts: {
    breakdownId: string;
    unitId: string;
    date: Date;
    issueDescription: string;
    parts: { partId: string; qty: number }[];
    userId: string;
  }
) {
  for (const line of opts.parts) {
    const part = await tx.masterPart.findUnique({ where: { id: line.partId } });
    if (!part) throw new Error("Barang stok tidak ditemukan");
    if (line.qty > part.stock) {
      throw new Error(
        `Stok ${part.name} tidak cukup (tersedia ${part.stock})`
      );
    }
    const totalPrice = line.qty * part.averagePrice;
    const updatedPart = await tx.masterPart.update({
      where: { id: part.id },
      data: { stock: part.stock - line.qty },
    });
    const txRow = await tx.inventoryTransaction.create({
      data: {
        partId: part.id,
        type: InvTransactionType.OUT,
        date: opts.date,
        qty: line.qty,
        totalPrice,
        unitId: opts.unitId,
        breakdownId: opts.breakdownId,
        notes: `Breakdown: ${opts.issueDescription}`,
      },
    });
    await tx.auditLog.createMany({
      data: [
        {
          userId: opts.userId,
          action: AuditAction.UPDATE,
          tableName: "MasterPart",
          recordId: part.id,
          oldData: toJson(part),
          newData: toJson(updatedPart),
        },
        {
          userId: opts.userId,
          action: AuditAction.CREATE,
          tableName: "InventoryTransaction",
          recordId: txRow.id,
          newData: toJson(txRow),
        },
      ],
    });
  }
}

/** Restore stock when breakdown is deleted */
async function restorePartsForBreakdown(
  tx: Prisma.TransactionClient,
  breakdownId: string,
  userId: string
) {
  const outs = await tx.inventoryTransaction.findMany({
    where: { breakdownId, type: InvTransactionType.OUT },
  });
  for (const row of outs) {
    const part = await tx.masterPart.findUnique({ where: { id: row.partId } });
    if (part) {
      const updated = await tx.masterPart.update({
        where: { id: part.id },
        data: { stock: part.stock + row.qty },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.UPDATE,
          tableName: "MasterPart",
          recordId: part.id,
          oldData: toJson(part),
          newData: toJson(updated),
        },
      });
    }
    await tx.inventoryTransaction.delete({ where: { id: row.id } });
    await tx.auditLog.create({
      data: {
        userId,
        action: AuditAction.DELETE,
        tableName: "InventoryTransaction",
        recordId: row.id,
        oldData: toJson(row),
      },
    });
  }
}

/** Sync / remove BIAYA_BREAKDOWN cash outflow tied to a breakdown row */
async function syncBreakdownCashJournal(
  tx: Prisma.TransactionClient,
  opts: {
    breakdownId: string;
    date: Date;
    issueDescription: string;
    maintenanceCost: number;
    unitId: string;
    unitNumber: string;
    userId: string;
  }
) {
  const notePrefix = `[breakdown:${opts.breakdownId}]`;
  const existing = await tx.hppJournalEntry.findFirst({
    where: {
      category: JournalCategory.BIAYA_BREAKDOWN,
      notes: { startsWith: notePrefix },
    },
  });

  if (opts.maintenanceCost <= 0) {
    if (existing) {
      await tx.hppJournalEntry.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          userId: opts.userId,
          action: AuditAction.DELETE,
          tableName: "HppJournalEntry",
          recordId: existing.id,
          oldData: toJson(existing),
        },
      });
    }
    return;
  }

  const data = {
    date: opts.date,
    entryType: JournalEntryType.CASH_OUT,
    category: JournalCategory.BIAYA_BREAKDOWN,
    description: journalDescription(opts.issueDescription, opts.unitNumber),
    amount: opts.maintenanceCost,
    unitId: opts.unitId,
    notes: breakdownJournalNotes(opts.breakdownId, opts.issueDescription),
    createdById: opts.userId,
    kasOnly: false,
  };

  if (existing) {
    const updated = await tx.hppJournalEntry.update({
      where: { id: existing.id },
      data,
    });
    await tx.auditLog.create({
      data: {
        userId: opts.userId,
        action: AuditAction.UPDATE,
        tableName: "HppJournalEntry",
        recordId: existing.id,
        oldData: toJson(existing),
        newData: toJson(updated),
      },
    });
  } else {
    const created = await tx.hppJournalEntry.create({ data });
    await tx.auditLog.create({
      data: {
        userId: opts.userId,
        action: AuditAction.CREATE,
        tableName: "HppJournalEntry",
        recordId: created.id,
        newData: toJson(created),
      },
    });
  }
}

export async function createBreakdown(
  raw: BreakdownInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertBreakdownWrite();
    const parsed = breakdownSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid",
      };
    }

    let data;
    try {
      data = mapData(parsed.data);
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Data tidak valid",
      };
    }

    const unit = await prisma.masterUnit.findUnique({
      where: { id: data.unitId },
    });
    if (!unit) return { success: false, error: "Unit tidak ditemukan" };

    const parts = (parsed.data.parts ?? []).filter((p) => p.qty > 0);

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.breakdownHistory.create({ data });
      await syncUnitStatus(tx, data.unitId);
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: AuditAction.CREATE,
          tableName: "BreakdownHistory",
          recordId: created.id,
          newData: toJson(created),
        },
      });

      if (parts.length) {
        await consumePartsForBreakdown(tx, {
          breakdownId: created.id,
          unitId: unit.id,
          date: data.date,
          issueDescription: data.issueDescription,
          parts,
          userId: session.user.id,
        });
      }

      if (data.maintenanceCost > 0) {
        await syncBreakdownCashJournal(tx, {
          breakdownId: created.id,
          date: data.date,
          issueDescription: data.issueDescription,
          maintenanceCost: data.maintenanceCost,
          unitId: unit.id,
          unitNumber: unit.unitNumber,
          userId: session.user.id,
        });
      }

      return created;
    });

    revalidatePath("/breakdown");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/masters/units");
    revalidatePath("/finance/kas");
    revalidatePath("/finance/buku-harian");
    revalidatePath("/finance/profitabilitas");
    return { success: true, data: { id: row.id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal simpan breakdown",
    };
  }
}

export async function updateBreakdown(
  id: string,
  raw: BreakdownInput
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertBreakdownWrite();
    const parsed = breakdownSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid",
      };
    }

    const existing = await prisma.breakdownHistory.findUnique({
      where: { id },
    });
    if (!existing) return { success: false, error: "Data tidak ditemukan" };

    let data;
    try {
      data = mapData(parsed.data);
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Data tidak valid",
      };
    }

    const unit = await prisma.masterUnit.findUnique({
      where: { id: data.unitId },
    });
    if (!unit) return { success: false, error: "Unit tidak ditemukan" };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.breakdownHistory.update({
        where: { id },
        data,
      });

      if (existing.unitId !== data.unitId) {
        await syncUnitStatus(tx, existing.unitId);
      }
      await syncUnitStatus(tx, data.unitId);

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: AuditAction.UPDATE,
          tableName: "BreakdownHistory",
          recordId: id,
          oldData: toJson(existing),
          newData: toJson(updated),
        },
      });

      await syncBreakdownCashJournal(tx, {
        breakdownId: id,
        date: data.date,
        issueDescription: data.issueDescription,
        maintenanceCost: data.maintenanceCost,
        unitId: unit.id,
        unitNumber: unit.unitNumber,
        userId: session.user.id,
      });
    });

    revalidatePath("/breakdown");
    revalidatePath("/dashboard");
    revalidatePath("/masters/units");
    revalidatePath("/finance/kas");
    revalidatePath("/finance/buku-harian");
    revalidatePath("/finance/profitabilitas");
    return { success: true, data: { id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal update breakdown",
    };
  }
}

export async function deleteBreakdown(
  id: string
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await assertBreakdownWrite();
    const existing = await prisma.breakdownHistory.findUnique({
      where: { id },
    });
    if (!existing) return { success: false, error: "Data tidak ditemukan" };

    await prisma.$transaction(async (tx) => {
      const notePrefix = `[breakdown:${id}]`;
      const journal = await tx.hppJournalEntry.findFirst({
        where: {
          category: JournalCategory.BIAYA_BREAKDOWN,
          notes: { startsWith: notePrefix },
        },
      });
      if (journal) {
        await tx.hppJournalEntry.delete({ where: { id: journal.id } });
        await tx.auditLog.create({
          data: {
            userId: session.user.id,
            action: AuditAction.DELETE,
            tableName: "HppJournalEntry",
            recordId: journal.id,
            oldData: toJson(journal),
          },
        });
      }

      await restorePartsForBreakdown(tx, id, session.user.id);

      await tx.breakdownHistory.delete({ where: { id } });
      await syncUnitStatus(tx, existing.unitId);
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: AuditAction.DELETE,
          tableName: "BreakdownHistory",
          recordId: id,
          oldData: toJson(existing),
        },
      });
    });

    revalidatePath("/breakdown");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    revalidatePath("/masters/units");
    revalidatePath("/finance/kas");
    revalidatePath("/finance/buku-harian");
    revalidatePath("/finance/profitabilitas");
    return { success: true, data: { id } };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Gagal hapus breakdown",
    };
  }
}
