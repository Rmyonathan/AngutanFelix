-- CreateEnum
CREATE TYPE "PartCategory" AS ENUM ('BAN', 'OLI', 'SPAREPART', 'LAINNYA');

-- CreateEnum
CREATE TYPE "InvTransactionType" AS ENUM ('IN', 'OUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalCategory" ADD VALUE 'BIAYA_STOK';
ALTER TYPE "JournalCategory" ADD VALUE 'BIAYA_BREAKDOWN';

-- AlterTable
ALTER TABLE "master_cost_configs" ADD COLUMN     "isHppEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "master_parts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PartCategory" NOT NULL DEFAULT 'LAINNYA',
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averagePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "master_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "type" "InvTransactionType" NOT NULL,
    "date" DATE NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "unitId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_parts_category_idx" ON "master_parts"("category");

-- CreateIndex
CREATE INDEX "inventory_transactions_date_idx" ON "inventory_transactions"("date");

-- CreateIndex
CREATE INDEX "inventory_transactions_partId_date_idx" ON "inventory_transactions"("partId", "date");

-- CreateIndex
CREATE INDEX "inventory_transactions_unitId_date_idx" ON "inventory_transactions"("unitId", "date");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions"("type");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_partId_fkey" FOREIGN KEY ("partId") REFERENCES "master_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "master_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
