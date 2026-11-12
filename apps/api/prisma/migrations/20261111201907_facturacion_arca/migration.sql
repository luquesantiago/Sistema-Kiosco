-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('pendiente', 'en_curso', 'autorizada', 'error', 'cancelada');

-- CreateEnum
CREATE TYPE "ParteFactura" AS ENUM ('electronica', 'efectivo');

-- AlterEnum
ALTER TYPE "TipoNotificacion" ADD VALUE 'factura';

-- CreateTable
CREATE TABLE "facturas" (
    "id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "parte" "ParteFactura" NOT NULL,
    "pedida_por_id" UUID,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'pendiente',
    "punto_venta" INTEGER NOT NULL,
    "tipo_comprobante" INTEGER NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,
    "numero" INTEGER,
    "fecha_comprobante" DATE,
    "cae" TEXT,
    "cae_vencimiento" DATE,
    "autorizada_en" TIMESTAMPTZ,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximo_intento_en" TIMESTAMPTZ,
    "codigo_error" TEXT,
    "error" TEXT,
    "creada_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets_acceso_arca" (
    "servicio" TEXT NOT NULL,
    "entorno" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "generado_en" TIMESTAMPTZ NOT NULL,
    "expira_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tickets_acceso_arca_pkey" PRIMARY KEY ("servicio","entorno")
);

-- CreateIndex
CREATE INDEX "facturas_estado_creada_en_idx" ON "facturas"("estado", "creada_en");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_venta_id_parte_key" ON "facturas"("venta_id", "parte");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_punto_venta_tipo_comprobante_numero_key" ON "facturas"("punto_venta", "tipo_comprobante", "numero");

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_pedida_por_id_fkey" FOREIGN KEY ("pedida_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
