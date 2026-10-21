-- CreateEnum
CREATE TYPE "TipoMovimientoCaja" AS ENUM ('gasto', 'retiro', 'ingreso');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoNotificacion" ADD VALUE 'gasto_caja';
ALTER TYPE "TipoNotificacion" ADD VALUE 'retiro_caja';
ALTER TYPE "TipoNotificacion" ADD VALUE 'cierre_turno';

-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "anulacion_turno_id" UUID,
ADD COLUMN     "turno_id" UUID;

-- CreateTable
CREATE TABLE "turnos" (
    "id" UUID NOT NULL,
    "abierto_por_id" UUID NOT NULL,
    "abierto_en" TIMESTAMPTZ NOT NULL,
    "monto_sugerido" DECIMAL(12,2) NOT NULL,
    "monto_inicial" DECIMAL(12,2) NOT NULL,
    "cerrado_por_id" UUID,
    "cerrado_en" TIMESTAMPTZ,
    "monto_contado" DECIMAL(12,2),
    "retiro_cierre" DECIMAL(12,2),
    "motivo_retiro_cierre" TEXT,
    "esperado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "quedo_en_caja" DECIMAL(12,2),

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_caja" (
    "id" UUID NOT NULL,
    "turno_id" UUID NOT NULL,
    "tipo" "TipoMovimientoCaja" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turnos_abierto_en_idx" ON "turnos"("abierto_en");

-- CreateIndex
CREATE INDEX "movimientos_caja_turno_id_creado_en_idx" ON "movimientos_caja"("turno_id", "creado_en");

-- CreateIndex
CREATE INDEX "ventas_turno_id_idx" ON "ventas"("turno_id");

-- CreateIndex
CREATE INDEX "ventas_anulacion_turno_id_idx" ON "ventas"("anulacion_turno_id");

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anulacion_turno_id_fkey" FOREIGN KEY ("anulacion_turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_abierto_por_id_fkey" FOREIGN KEY ("abierto_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_cerrado_por_id_fkey" FOREIGN KEY ("cerrado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_caja" ADD CONSTRAINT "movimientos_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Agregado a mano: una sola caja, así que como máximo un turno abierto.
-- Prisma no expresa índices parciales; ver el comentario del modelo Turno.
CREATE UNIQUE INDEX "turnos_un_solo_abierto" ON "turnos" ((true)) WHERE "cerrado_en" IS NULL;
