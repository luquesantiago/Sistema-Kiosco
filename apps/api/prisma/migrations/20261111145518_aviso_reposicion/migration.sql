-- AlterEnum
ALTER TYPE "EstadoNotificacion" ADD VALUE 'reemplazada';

-- AlterEnum
ALTER TYPE "TipoNotificacion" ADD VALUE 'reposicion';

-- CreateTable
CREATE TABLE "ejecuciones_tarea" (
    "id" UUID NOT NULL,
    "tarea" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "ejecutada_en" TIMESTAMPTZ NOT NULL,
    "notificacion_id" UUID,

    CONSTRAINT "ejecuciones_tarea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ejecuciones_tarea_notificacion_id_key" ON "ejecuciones_tarea"("notificacion_id");

-- CreateIndex
CREATE UNIQUE INDEX "ejecuciones_tarea_tarea_fecha_key" ON "ejecuciones_tarea"("tarea", "fecha");

-- AddForeignKey
ALTER TABLE "ejecuciones_tarea" ADD CONSTRAINT "ejecuciones_tarea_notificacion_id_fkey" FOREIGN KEY ("notificacion_id") REFERENCES "notificaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
