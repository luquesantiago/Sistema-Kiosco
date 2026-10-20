-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo');

-- CreateEnum
CREATE TYPE "OrigenCambioPrecio" AS ENUM ('manual', 'aumento_masivo');

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "notas" TEXT,
    "dias_pedido" "DiaSemana"[],
    "dias_entrega" "DiaSemana"[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos" (
    "id" UUID NOT NULL,
    "codigo_barras" TEXT,
    "nombre" TEXT NOT NULL,
    "nombre_busqueda" TEXT NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "costo" DECIMAL(12,2),
    "stock_actual" INTEGER NOT NULL DEFAULT 0,
    "stock_minimo" INTEGER NOT NULL,
    "stock_maximo" INTEGER NOT NULL,
    "proveedor_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "productos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cambios_precio" (
    "id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "precio_anterior" DECIMAL(12,2) NOT NULL,
    "precio_nuevo" DECIMAL(12,2) NOT NULL,
    "costo_anterior" DECIMAL(12,2),
    "costo_nuevo" DECIMAL(12,2),
    "origen" "OrigenCambioPrecio" NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambios_precio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "productos_codigo_barras_key" ON "productos"("codigo_barras");

-- CreateIndex
CREATE INDEX "productos_nombre_busqueda_idx" ON "productos"("nombre_busqueda");

-- CreateIndex
CREATE INDEX "productos_proveedor_id_idx" ON "productos"("proveedor_id");

-- CreateIndex
CREATE INDEX "cambios_precio_producto_id_creado_en_idx" ON "cambios_precio"("producto_id", "creado_en");

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_precio" ADD CONSTRAINT "cambios_precio_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "productos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_precio" ADD CONSTRAINT "cambios_precio_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
