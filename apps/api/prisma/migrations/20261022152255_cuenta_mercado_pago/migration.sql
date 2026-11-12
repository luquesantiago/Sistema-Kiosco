-- CreateEnum
CREATE TYPE "Cuenta" AS ENUM ('efectivo', 'mercado_pago');

-- AlterTable
ALTER TABLE "movimientos_caja" ADD COLUMN     "cuenta" "Cuenta" NOT NULL DEFAULT 'efectivo',
ALTER COLUMN "turno_id" DROP NOT NULL;
