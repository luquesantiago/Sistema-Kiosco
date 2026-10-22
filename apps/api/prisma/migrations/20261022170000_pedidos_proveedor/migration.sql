-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('por_llegar', 'llego', 'cargado', 'cancelado');

-- AlterEnum
ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'pago_proveedor';

-- AlterEnum
ALTER TYPE "TipoNotificacion" ADD VALUE 'pedido_cerrado';

-- AlterTable
ALTER TABLE "ingresos_mercaderia" ADD COLUMN     "pedido_id" UUID;

-- AlterTable
ALTER TABLE "movimientos_caja" ADD COLUMN     "pedido_id" UUID;

-- CreateTable
CREATE TABLE "pedidos" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "proveedor_id" UUID NOT NULL,
    "total_pedido" DECIMAL(12,2) NOT NULL,
    "llega_el" DATE NOT NULL,
    "nota" TEXT,
    "creado_por_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'por_llegar',
    "total" DECIMAL(12,2),
    "nota_recepcion" TEXT,
    "llego_en" TIMESTAMPTZ,
    "recibido_por_id" UUID,
    "cancelado_en" TIMESTAMPTZ,
    "cancelado_por_id" UUID,
    "motivo_cancelacion" TEXT,
    "cerrado_en" TIMESTAMPTZ,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_numero_key" ON "pedidos"("numero");

-- CreateIndex
CREATE INDEX "pedidos_estado_idx" ON "pedidos"("estado");

-- CreateIndex
CREATE INDEX "pedidos_cerrado_en_idx" ON "pedidos"("cerrado_en");

-- CreateIndex
CREATE UNIQUE INDEX "ingresos_mercaderia_pedido_id_key" ON "ingresos_mercaderia"("pedido_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_pedido_id_key" ON "movimientos_caja"("pedido_id");

-- AddForeignKey
ALTER TABLE "ingresos_mercaderia" ADD CONSTRAINT "ingresos_mercaderia_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_recibido_por_id_fkey" FOREIGN KEY ("recibido_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cancelado_por_id_fkey" FOREIGN KEY ("cancelado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

