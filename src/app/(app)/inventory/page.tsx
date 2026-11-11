import { InventoryClient } from "@/components/inventory/inventory-client";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { formatDateOnly } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const session = await requireSession();
  const canRead =
    hasPermission(session.user.role, "inventory:read") ||
    hasPermission(session.user.role, "inventory:write") ||
    hasPermission(session.user.role, "*");
  if (!canRead) redirect("/dashboard?error=forbidden");

  const canWrite =
    hasPermission(session.user.role, "inventory:write") ||
    hasPermission(session.user.role, "*");

  const [parts, transactions] = await Promise.all([
    prisma.masterPart.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.inventoryTransaction.findMany({
      include: {
        part: { select: { name: true, category: true } },
        unit: { select: { unitNumber: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);

  return (
    <InventoryClient
      canWrite={canWrite}
      parts={parts.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        stock: p.stock,
        averagePrice: p.averagePrice,
      }))}
      transactions={transactions.map((t) => ({
        id: t.id,
        date: formatDateOnly(t.date),
        type: t.type,
        qty: t.qty,
        totalPrice: t.totalPrice,
        partName: t.part.name,
        partCategory: t.part.category,
        unitNumber: t.unit?.unitNumber ?? null,
        notes: t.notes,
      }))}
    />
  );
}
