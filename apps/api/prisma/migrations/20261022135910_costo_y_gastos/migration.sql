-- CreateEnum
CREATE TYPE "CategoriaGasto" AS ENUM ('servicios', 'insumos', 'otro');

-- AlterTable
ALTER TABLE "items_venta" ADD COLUMN     "costo_unitario" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "movimientos_caja" ADD COLUMN     "categoria" "CategoriaGasto";

-- Los gastos anteriores a las categorías (solo de desarrollo) quedan como "otro".
UPDATE "movimientos_caja" SET "categoria" = 'otro' WHERE "tipo" = 'gasto';
