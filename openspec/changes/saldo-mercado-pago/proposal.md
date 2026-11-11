# Proposal

## Why

El sistema ya separa el efectivo del cajón de la **cuenta de Mercado Pago del kiosco**, pero de MP solo muestra los movimientos que se anotan a mano: nadie ve cuánta plata hay. Hoy el admin abre la app de MP para saberlo y el empleado no tiene forma de verlo. El cambio archivado `cuenta-mercado-pago` dejó decidido que el saldo **no se calcula ni se ajusta a mano**: se lee de la API de Mercado Pago. Además, este cambio arma la integración con MP (credenciales, cliente HTTP y cliente falso para tests) que va a reutilizar `cobro-mercado-pago`.

## What Changes

- El sistema lee el **saldo de la cuenta de Mercado Pago del kiosco** desde la API de MP: lo **disponible** y, si MP lo informa, lo que está **a liberar**.
- El saldo se guarda en una **caché de 60 s**: varias pantallas abiertas o refrescos seguidos hacen una sola consulta a MP por minuto.
- Si MP no responde en 10 s, se muestra el **último saldo leído con su hora**; si nunca se pudo leer, se muestra "Saldo no disponible". Nunca se calcula un saldo propio.
- Lo ven:
  - **El admin** en **Administración → Mercado Pago** (arriba de los movimientos) y en el **dashboard**, junto al efectivo en caja.
  - **El empleado** en el diálogo de **Caja (F8)** del mostrador.
- Si el sistema no tiene credenciales de MP, el saldo aparece como "Mercado Pago no configurado" y todo lo demás funciona igual.
- Se suma la configuración de Mercado Pago (`MP_ACCESS_TOKEN`), opcional, y el módulo de integración que comparten este cambio y `cobro-mercado-pago`.
- **Se reemplaza la regla del dashboard que decía que el saldo de MP no se muestra.**

Fuera de alcance:
- Cobrar con Point o QR, webhooks y ventas en espera: cambio `cobro-mercado-pago`.
- Conciliar movimientos de MP contra la API o listar los movimientos de la cuenta que vienen de MP.
- El **plan B** (saldo de referencia cargado a mano más los movimientos), que solo se haría si la prueba con credenciales reales muestra que la API no da el saldo. Queda documentado en el design.

## Capabilities

### New Capabilities

- `mercado-pago`: integración con la cuenta de Mercado Pago del kiosco. Este cambio suma la configuración y el saldo; `cobro-mercado-pago` suma el cobro.

### Modified Capabilities

- `dashboard`: el bloque de "ahora" muestra el saldo de Mercado Pago junto al efectivo en caja (antes la regla decía que no se mostraba).
- `caja`: el empleado y el admin ven el saldo de Mercado Pago desde la caja del mostrador.

## Impact

- **API:**
  - `src/integrations/mercadopago/cliente.ts` nuevo (interfaz `ClienteMercadoPago`, timeout de 10 s y diferencia entre "no responde" y "rechazó").
  - `src/modules/mercadopago/` nuevo (servicio del saldo con caché y `GET /api/mercado-pago/saldo`).
  - `config.ts` (`MP_ACCESS_TOKEN` opcional), `app.ts` (`mercadoPago?` inyectable) y `server.ts` (crea el cliente si hay token). `GET /api/dashboard` no cambia: la web pide el saldo aparte.
- **Compartido:** `packages/shared/src/mercadopago.ts` nuevo (esquema del saldo) y `index.ts`.
- **Web:** `admin/MercadoPago.tsx` (tarjeta del saldo; se saca el texto "el saldo llega en la Etapa 5"), `admin/Dashboard.tsx` y `pos/Caja.tsx` (línea de saldo en F8).
- **Tests:** cliente falso `test/mercadopago-falso.ts`, tests del cliente contra un servidor HTTP local y ruta nueva en `rutas-protegidas.test.ts`.
- **Base de datos:** sin cambios.
- **Docs:** `docs/requisitos-y-limites.md`, `docs/estructura-proyecto.md`, `apps/api/.env.example` e `infra/.env.example`.
