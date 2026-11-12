# Tasks

## 1. Tests de valor límite (antes del código)

- [x] 1.1 Escribir en `apps/api/test/mercadopago-saldo.test.ts`, con el cliente falso y el reloj controlado, los escenarios de "Caché del saldo": lectura a las 10:00:00,000 y consultas a las 10:00:59,999 (sin llamada a MP), 10:01:00,000 y 10:01:00,001 (con llamada), y 3 consultas simultáneas con la caché vencida (una sola llamada). Verificar que fallan por falta de implementación y no por errores del test.
- [x] 1.2 Escribir los escenarios de "Saldo cuando Mercado Pago no responde": respuesta a los 9,9 s (saldo nuevo), sin respuesta a los 10 s con y sin saldo anterior, credenciales rechazadas (401) y reintento a los 10 s de una falla. En `apps/api/test/mercadopago-cliente.test.ts`, el timeout contra un servidor HTTP local que tarda 9,9 s y 10 s (con `timeoutMs` reducido proporcionalmente si hace falta, dejando el borde explícito). Verificar que fallan por falta de implementación.
- [x] 1.3 Escribir en `apps/api/test/config.test.ts` los casos de `MP_ACCESS_TOKEN`: ausente (arranca), vacía (falla nombrando la variable, sin el valor) y con valor (arranca). Verificar que el caso vacío falla hoy.
- [x] 1.4 Escribir los escenarios de "Saldo de la cuenta de Mercado Pago" y "Sistema sin Mercado Pago configurado" contra `GET /api/mercado-pago/saldo`: admin, empleado, sin sesión (`401`), sin "a liberar", `no_configurado` sin llamadas al cliente y `GET /api/health` con MP caído. Sumar la ruta al test de rutas protegidas. Verificar que fallan por falta de la ruta.

## 2. Integración con Mercado Pago

- [x] 2.1 Sumar `MP_ACCESS_TOKEN` opcional a `cargarConfig` y comentada a `apps/api/.env.example` e `infra/.env.example`. Verificar con los tests de 1.3.
- [x] 2.2 Crear `apps/api/src/integrations/mercadopago/cliente.ts` con la interfaz `ClienteMercadoPago` (`saldo()`), `MercadoPagoNoDisponible`, `MercadoPagoRechazo` y `clienteMercadoPago(token, { baseUrl, timeoutMs })` según el design (usuario de `/users/me` en memoria, montos por `Decimal`, mensajes sin token). Verificar con `mercadopago-cliente.test.ts` contra el servidor HTTP local: saldo con y sin `unavailable_balance`, 401, 500, error de red y timeout.
- [x] 2.3 Crear `apps/api/test/mercadopago-falso.ts` con saldo, demora y errores programables y contador de llamadas, pensado para que `cobro-mercado-pago` le sume las órdenes. Verificar que lo usan los tests de 1.1 y 1.2.

## 3. Saldo en la API

- [x] 3.1 Agregar `packages/shared/src/mercadopago.ts` (esquema `SaldoMercadoPago` y `textoSaldoNoDisponible`) y exportarlo en `index.ts`. Verificar con un test unitario de los tres textos.
- [x] 3.2 Implementar `crearServicioSaldo` en `apps/api/src/modules/mercadopago/saldo.ts` (vigencia de 60 s, `< 60_000` vigente, promesa compartida, fallas sin guardar). Verificar que pasan los tests de 1.1 y 1.2.
- [x] 3.3 Implementar `GET /api/mercado-pago/saldo` en `modules/mercadopago/rutas.ts`, aceptar `mercadoPago?` en `crearApp` y crear el cliente en `server.ts` solo si hay token. Verificar que pasan los tests de 1.4 y `rutas-protegidas.test.ts`.

## 4. Web

- [x] 4.1 Crear el componente del saldo (consulta con `refetchInterval` y `staleTime` de 60 s; disponible, a liberar, hora, desactualizado y textos de no disponible) y usarlo en `admin/MercadoPago.tsx` con **Actualizar**, sacando el texto "el saldo llega en la Etapa 5". Verificar con tests de Testing Library los estados `disponible`, desactualizado, `no_disponible` y `no_configurado`.
  - Tests ya escritos (antes del código) en `apps/web/test/saldo-mercado-pago.test.tsx`, bloque "Administración → Mercado Pago".
- [x] 4.2 Mostrar el saldo en `admin/Dashboard.tsx`, en la fila de "ahora", con su propia consulta. Verificar con tests que el resto del dashboard se muestra aunque la consulta del saldo falle o tarde, y que cambiar el período no vuelve a pedir el saldo.
  - Tests ya escritos (antes del código) en `apps/web/test/saldo-mercado-pago.test.tsx`, bloque "dashboard".
- [x] 4.3 Sumar la línea del saldo en `DialogoCaja` (`pos/Caja.tsx`), oculta si no está configurado. Verificar con tests de Testing Library los escenarios del requisito "Saldo de Mercado Pago desde la caja del mostrador" y que el empleado no ve el esperado.
  - Tests ya escritos (antes del código) en `apps/web/test/saldo-mercado-pago.test.tsx`, bloque "Caja (F8)".

## 5. Verificación y documentación

- [ ] 5.1 Correr `pnpm --filter api test`, `pnpm --filter web test`, `pnpm typecheck` y `pnpm lint`, y verificar que todo pasa.
- [x] 5.2 Actualizar `docs/requisitos-y-limites.md` (saldo leído de la API, caché de 60 s, quién lo ve, plan B), `docs/estructura-proyecto.md` (`src/integrations/mercadopago/` y `modules/mercadopago/`) e `infra/README.md` (dónde cargar el token). Verificar que coinciden con los specs del cambio.

## 6. Prueba con credenciales reales (cuando el dueño las tenga)

- [ ] 6.1 Con el token de prueba y después con el de producción en `apps/api/.env`, abrir Administración → Mercado Pago y verificar que el saldo coincide con la app de MP (disponible y a liberar). Si el recurso responde 403/404 o no trae el saldo, anotarlo en el design y abrir el cambio del plan B.

## Qué tiene que aportar el dueño

- Una **aplicación** creada en Mercado Pago Developers (Tus integraciones) con la cuenta de MP del kiosco.
- El **Access Token de prueba** y el **de producción** de esa aplicación (se cargan en `infra/.env`, nunca en el repo ni por chat).
- Un rato con la app de MP abierta para comparar el saldo en la prueba 6.1.

## Workflow follow-up

- Mergear después de `aviso-reposicion-diario` y antes de `cobro-mercado-pago`, que usa `src/integrations/mercadopago/`.
- Archivar con `/opsx:archive` cuando la CI esté en verde. La tarea 6.1 puede quedar pendiente hasta que haya credenciales; si es así, anotarlo al archivar.
