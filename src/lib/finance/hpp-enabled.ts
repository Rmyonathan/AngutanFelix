import { prisma } from "@/lib/prisma";

/** Global switch for theoretical HPP engine (ban / cicilan / depresiasi). Default OFF. */
export async function isHppEngineEnabled(): Promise<boolean> {
  const config = await prisma.masterCostConfig.findFirst({
    where: { isActive: true },
    select: { isHppEnabled: true },
    orderBy: { updatedAt: "desc" },
  });
  return Boolean(config?.isHppEnabled);
}
