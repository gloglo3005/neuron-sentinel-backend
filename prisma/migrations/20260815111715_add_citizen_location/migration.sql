-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLatitude" DOUBLE PRECISION,
ADD COLUMN     "lastLongitude" DOUBLE PRECISION,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3);
