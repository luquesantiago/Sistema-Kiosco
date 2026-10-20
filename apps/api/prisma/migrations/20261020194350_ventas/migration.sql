-- CreateEnum
CREATE TYPE "MedioPago" AS ENUM ('efectivo', 'debito', 'credito', 'mercado_pago');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('pagada', 'anulada');

-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('anulacion_venta');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('pendiente', 'enviada', 'error');

-- AlterTable
ALTER TABLE "movimientos_stock" ADD COLUMN     "venta_id" UUID;

-- CreateTable
CREATE TABLE "ventas" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "usuario_id" UUID NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoVenta" NOT NULL DEFAULT 'pagada',
    "creada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anulada_en" TIMESTAMPTZ,
    "anulada_por_id" UUID,
    "motivo_anulacion" TEXT,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items_venta" (
    "id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "producto_id" UUID,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "items_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_venta" (
    "id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "monto_recibido" DECIMAL(12,2),
    "vuelto" DECIMAL(12,2),

    CONSTRAINT "pagos_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "destino" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'pendiente',
    "creada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviada_en" TIMESTAMPTZ,
    "error" TEXT,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ventas_numero_key" ON "ventas"("numero");

-- CreateIndex
CREATE INDEX "ventas_creada_en_idx" ON "ventas"("creada_en");

-- CreateIndex
CREATE INDEX "items_venta_venta_id_idx" ON "items_venta"("venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_venta_venta_id_medio_key" ON "pagos_venta"("venta_id", "medio");

-- CreateIndex
CREATE INDEX "notificaciones_creada_en_idx" ON "notificaciones"("creada_en");

-- CreateIndex
CREATE INDEX "movimientos_stock_venta_id_idx" ON "movimientos_stock"("venta_id");

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_venta" ADD CONSTRAINT "items_venta_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items_venta" ADD CONSTRAINT "items_venta_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_venta" ADD CONSTRAINT "pagos_venta_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
