-- AlterTable
ALTER TABLE "notificaciones" ADD COLUMN     "intentos" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proximo_intento_en" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "configuracion_whatsapp" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "numero" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "actualizado_en" TIMESTAMPTZ NOT NULL,
    "actualizado_por_id" UUID NOT NULL,

    CONSTRAINT "configuracion_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notificaciones_estado_creada_en_idx" ON "notificaciones"("estado", "creada_en");

-- AddForeignKey
ALTER TABLE "configuracion_whatsapp" ADD CONSTRAINT "configuracion_whatsapp_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
