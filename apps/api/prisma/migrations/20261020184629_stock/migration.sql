-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('compra', 'ajuste', 'venta', 'anulacion');

-- CreateEnum
CREATE TYPE "MotivoAjuste" AS ENUM ('rotura', 'vencimiento', 'robo', 'conteo', 'venta_sin_sistema', 'correccion', 'otro');

-- CreateTable
CREATE TABLE "movimientos_stock" (
    "id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "motivo" "MotivoAjuste",
    "cantidad" INTEGER NOT NULL,
    "stock_resultante" INTEGER NOT NULL,
    "nota" TEXT,
    "usuario_id" UUID NOT NULL,
    "ingreso_id" UUID,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingresos_mercaderia" (
    "id" UUID NOT NULL,
    "proveedor_id" UUID,
    "usuario_id" UUID NOT NULL,
    "nota" TEXT,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingresos_mercaderia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_ingreso" (
    "id" UUID NOT NULL,
    "ingreso_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "costo_unitario" DECIMAL(12,2),

    CONSTRAINT "items_ingreso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_stock_producto_id_creado_en_idx" ON "movimientos_stock"("producto_id", "creado_en");

-- CreateIndex
CREATE INDEX "movimientos_stock_ingreso_id_idx" ON "movimientos_stock"("ingreso_id");

-- CreateIndex
CREATE INDEX "ingresos_mercaderia_creado_en_idx" ON "ingresos_mercaderia"("creado_en");

-- CreateIndex
CREATE INDEX "items_ingreso_ingreso_id_idx" ON "items_ingreso"("ingreso_id");

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_ingreso_id_fkey" FOREIGN KEY ("ingreso_id") REFERENCES "ingresos_mercaderia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_ingreso" ADD CONSTRAINT "items_ingreso_ingreso_id_fkey" FOREIGN KEY ("ingreso_id") REFERENCES "ingresos_mercaderia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_ingreso" ADD CONSTRAINT "items_ingreso_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
