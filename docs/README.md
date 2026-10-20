# SistemaKiosco

Sistema de gestión para un kiosco familiar: ventas con lector de código de barras, stock por proveedor, control de caja por turno, avisos diarios de reposición por WhatsApp, facturación electrónica ARCA y un dashboard para el dueño.

## Por qué existe

El kiosco va a empezar a contratar empleados. El objetivo principal es **poder delegar el mostrador sin perder el control**: saber qué se vendió, quién lo vendió, cuánta plata tiene que haber en la caja y qué hay que reponer.

## Actores

| Actor | Qué hace | Dónde |
|---|---|---|
| **Admin** (dueño/familia) | Gestiona productos, precios, proveedores y usuarios; ve el dashboard y los cierres de caja | PC del kiosco y **celular** |
| **Empleado** | Abre y cierra su turno, vende y cobra | PC del kiosco |
| **Proveedor** | No usa el sistema; recibe pedidos (en persona o por teléfono) | — |

## Datos del negocio

- **Horario:** de 7:00 a 19:00.
- **Turnos:** 2 de 6 horas (de 7:00 a 13:00 y de 13:00 a 19:00).
- **Condición fiscal:** monotributista, por lo que emite **Factura C**.
- **Aviso de reposición:** todos los días a las **12:00** por WhatsApp al `<NUMERO_WHATSAPP_ADMIN>` (se configura en el sistema y no se guarda en el repositorio).

## Módulos

1. **Productos y precios:** catálogo con código de barras, precio y stock mínimo.
2. **Proveedores:** cada proveedor trae varios productos y tiene un día de toma de pedido y un día de entrega.
3. **Stock:** ingresos por compra, egresos por venta y ajustes registrados.
4. **Usuarios y roles:** admin y empleado.
5. **Ventas (POS):** venta rápida con el lector, con medios de pago efectivo, Mercado Pago y otros.
6. **Caja y turnos:** apertura, cierre, arqueo, retiros y diferencias por empleado.
7. **Dashboard:** ventas, productos más vendidos, ingresos y egresos.
8. **Reposición:** recomendaciones agrupadas por proveedor y aviso diario por WhatsApp.
9. **Facturación:** Factura C electrónica (ARCA, WSFE) e integración con Mercado Pago.

## Etapas

```
1. Base: productos, proveedores, stock, usuarios/roles, venta con lector
        |
2. Caja: turnos, apertura/cierre, arqueo, retiros
        |
3. Dashboard: ventas, top productos, ingresos/egresos
        |
4. Reposición + aviso diario por WhatsApp (WAHA)
        |
5. Facturación electrónica ARCA + integración Mercado Pago
```

Cada etapa se trabaja como un cambio de OpenSpec (`/opsx:propose`).

## Documentación

- [Estructura del proyecto](estructura-proyecto.md): módulos, arquitectura y modelo de datos.
- [Requisitos y límites](requisitos-y-limites.md): qué hace, qué no hace y preguntas abiertas.
- [Stack tecnológico](stack-tecnologico.md): decisiones técnicas (a definir).
