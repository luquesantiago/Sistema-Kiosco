-- CreateEnum
CREATE TYPE "EstadoCobroMp" AS ENUM ('creando', 'en_espera', 'cancelando', 'aprobado', 'rechazado', 'vencido', 'cancelado', 'a_revisar', 'a_devolver', 'devuelto', 'sin_devolver');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EstadoVenta" ADD VALUE 'pendiente';
ALTER TYPE "EstadoVenta" ADD VALUE 'cancelada';

-- AlterEnum
ALTER TYPE "TipoMovimientoCaja" ADD VALUE 'devolucion_cobro';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoNotificacion" ADD VALUE 'cobro_mp_a_revisar';
ALTER TYPE "TipoNotificacion" ADD VALUE 'devolucion_cobro_mp';

-- AlterTable
ALTER TABLE "movimientos_caja" ADD COLUMN     "cobro_mp_id" UUID;

-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "cancelada_en" TIMESTAMPTZ,
ADD COLUMN     "motivo_cancelacion" TEXT,
ADD COLUMN     "pagada_en" TIMESTAMPTZ,
ADD COLUMN     "vence_en" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "cobros_mp" (
    "id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "intento" INTEGER NOT NULL,
    "medio" "MedioPago" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "clave_idempotencia" UUID NOT NULL,
    "referencia_externa" TEXT NOT NULL,
    "orden_id" TEXT,
    "estado" "EstadoCobroMp" NOT NULL,
    "detalle" TEXT,
    "tipo_informado" TEXT,
    "cancelacion_pedida" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMPTZ NOT NULL,
    "consultado_en" TIMESTAMPTZ,
    "resuelto_en" TIMESTAMPTZ,
    "revisado_por_id" UUID,
    "revisado_en" TIMESTAMPTZ,
    "nota_revision" TEXT,

    CONSTRAINT "cobros_mp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avisos_mp" (
    "id" TEXT NOT NULL,
    "orden_id" TEXT,
    "recibido_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "avisos_mp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cobros_mp_clave_idempotencia_key" ON "cobros_mp"("clave_idempotencia");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_mp_referencia_externa_key" ON "cobros_mp"("referencia_externa");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_mp_orden_id_key" ON "cobros_mp"("orden_id");

-- CreateIndex
CREATE INDEX "cobros_mp_estado_idx" ON "cobros_mp"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_mp_venta_id_intento_key" ON "cobros_mp"("venta_id", "intento");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_caja_cobro_mp_id_tipo_key" ON "movimientos_caja"("cobro_mp_id", "tipo");

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_cobro_mp_id_fkey" FOREIGN KEY ("cobro_mp_id") REFERENCES "cobros_mp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros_mp" ADD CONSTRAINT "cobros_mp_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobros_mp" ADD CONSTRAINT "cobros_mp_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un solo cobro activo (creándose, esperando en la terminal o cancelándose) a la vez.
-- Prisma no expresa índices parciales: agregado a mano, como turnos_un_solo_abierto.
CREATE UNIQUE INDEX "cobros_mp_uno_activo" ON "cobros_mp" ((true)) WHERE "estado" IN ('creando', 'en_espera', 'cancelando');