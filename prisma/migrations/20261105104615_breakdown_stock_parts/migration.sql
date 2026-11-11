-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "breakdownId" TEXT;

-- CreateIndex
CREATE INDEX "inventory_transactions_breakdownId_idx" ON "inventory_transactions"("breakdownId");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_breakdownId_fkey" FOREIGN KEY ("breakdownId") REFERENCES "breakdown_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;
