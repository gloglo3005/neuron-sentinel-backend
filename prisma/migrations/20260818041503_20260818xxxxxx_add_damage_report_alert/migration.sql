-- AlterTable
ALTER TABLE "DamageReport" ADD COLUMN     "alertId" TEXT;

-- CreateIndex
CREATE INDEX "DamageReport_alertId_idx" ON "DamageReport"("alertId");

-- AddForeignKey
ALTER TABLE "DamageReport" ADD CONSTRAINT "DamageReport_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
