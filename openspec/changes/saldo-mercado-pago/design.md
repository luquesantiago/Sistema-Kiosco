# Design

## Context

- **Ya existe:**
  - El enum `Cuenta` (`efectivo`, `mercado_pago`) en `MovimientoCaja` y la pantalla **Administración → Mercado Pago** (`admin/MercadoPago.tsx`), que lista los movimientos de MP y dice que "el saldo llega en la Etapa 5".
  - El dashboard (`modules/dashboard/servicio.ts`) arma el bloque `ahora` (efectivo en caja y pendiente de pagar). Hoy su spec dice que el saldo de MP **no** se muestra.
  - El diálogo de **Caja (F8)** del mostrador (`pos/Caja.tsx`, `DialogoCaja`) con los movimientos del turno.
  - El patrón de integración externa de `envio-whatsapp`: `modules/whatsapp/cliente.ts` (interfaz inyectable, `fetch` con timeout de 10 s, `WhatsappNoDisponible` contra `WhatsappRechazo`), el cliente falso `test/whatsapp-falso.ts` y `cargarConfig` con variables opcionales que no muestran valores.
  - `test/rutas-protegidas.test.ts` exige que toda ruta de `/api` pida sesión y que las de admin den `403` al empleado, salvo una lista explícita.
- **Decisión archivada** (`2026-10-22-cuenta-mercado-pago/design.md`): el saldo de MP no se calcula ni se ajusta a mano; si la API no lo permite, se agrega un ajuste manual.
- **El dueño todavía no tiene credenciales de Mercado Pago.** Todo se desarrolla con el cliente falso y un servidor HTTP local; la lectura real se prueba después con credenciales de prueba y de producción.
- Requisitos en `specs/mercado-pago`, `specs/dashboard` y `specs/caja` de este cambio.

## Goals / Non-Goals

**Goals:**
- Que el admin y el empleado vean el saldo real de la cuenta de MP sin abrir la app de MP.
- Que una caída o demora de MP nunca frene el mostrador ni el dashboard.
- Dejar la integración con MP (`src/integrations/mercadopago/`) lista para que `cobro-mercado-pago` le sume el cobro sin rehacer nada.

**Non-Goals:**
- Calcular o conciliar el saldo con lo registrado en el sistema.
- Guardar el historial del saldo en la base: la caché vive en memoria.
- Implementar el plan B. Solo se documenta (ver "Plan B").

## Decisions

### Qué ofrece hoy la API de Mercado Pago para el saldo (investigado el 2026-11-10)

| Opción | Qué da | Estado en la documentación oficial |
|---|---|---|
| **A. `GET /users/{user_id}/mercadopago_account/balance`** (con `user_id` de `GET /users/me`) | Saldo al instante: disponible (`available_balance`), no disponible / a liberar (`unavailable_balance`) y total (`total_amount`). | **No figura en la documentación oficial actual.** Es un recurso histórico de la API que siguen usando clientes de la comunidad (por ejemplo, `pymercadopago` lo expone como `users.account_balance()`). Hay que probarlo con credenciales reales. |
| B1. Reporte "Dinero liberado" (`/v1/account/release_report`) | CSV con una fila `initial_available_balance` y los movimientos que liberan o bloquean plata. | Documentado. **No es al instante:** se pide por API, se genera de forma asíncrona ("lleva algunos minutos") y después se descarga. |
| B2. Reporte "Dinero en cuenta" (`account_money`) | Movimientos que afectaron el saldo. | Documentado; mismo esquema asíncrono que B1. |

**Decisión:** usar la **opción A** detrás de la interfaz del cliente, con la caché de 60 s. Es la única que da el saldo al instante. Como no está en la documentación oficial vigente, queda marcado que **hay que probarlo con credenciales reales** (tarea 6.1). Si no funciona, se pasa al plan B; los specs del saldo (estados, caché, timeout) no cambian, solo de dónde sale el número.

Fuentes:
- Reportes de MP, "Saldo en cuenta" y "Dinero liberado": https://www.mercadopago.com.ar/developers/es/docs/reports/account-money/introduction y https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/introduction
- API del reporte "Dinero liberado" (`/v1/account/release_report`, generación asíncrona): https://www.mercadopago.com.ar/developers/es/docs/reports/released-money/api
- Cliente de la comunidad con `account_balance()`: https://github.com/federicobond/pymercadopago

### Integración con MP en `src/integrations/mercadopago/`
- **Carpeta nueva `apps/api/src/integrations/mercadopago/`**, compartida con `cobro-mercado-pago`. Solo tiene lo que habla con MP (HTTP, tipos y errores); la lógica de negocio queda en `modules/`.
  - Se separa de `modules/` porque la usan dos módulos (saldo y cobros) y ninguno es su dueño. WhatsApp quedó en `modules/whatsapp/` porque tenía un solo dueño; no se mueve en este cambio.
- **`cliente.ts`** define la interfaz `ClienteMercadoPago`. Este cambio la crea con una sola operación, `saldo(): Promise<SaldoLeido>`, donde `SaldoLeido = { disponible: string; aLiberar: string | null }` (montos con 2 decimales). `cobro-mercado-pago` le suma las operaciones de órdenes.
- **`clienteMercadoPago(accessToken, { baseUrl = 'https://api.mercadopago.com', timeoutMs = 10_000 })`**:
  - `fetch` con `Authorization: Bearer`, `AbortSignal.timeout(timeoutMs)` y sin dependencias nuevas (no se usa el SDK oficial: suma peso y oculta los errores que hay que distinguir).
  - El `user_id` de `GET /users/me` se pide la primera vez y se guarda en memoria.
  - Los montos llegan como números JSON: se convierten a texto con 2 decimales pasando por `Decimal` desde el texto, nunca con `toFixed` de `number`.
- **Errores**, igual que en WhatsApp:
  - `MercadoPagoNoDisponible`: red, timeout o 5xx. "No responde".
  - `MercadoPagoRechazo(status, codigo)`: 4xx. "Rechazó"; con 401 y 403 el motivo es "credenciales".
  - Los mensajes nunca incluyen el token ni el cuerpo de la respuesta.
- **Cliente falso** `test/mercadopago-falso.ts`: saldo programable, demora programable, contador de llamadas y errores a pedido. `cobro-mercado-pago` le suma las órdenes.

### Caché del saldo en memoria
- **`modules/mercadopago/saldo.ts`** exporta `crearServicioSaldo({ cliente, ahora, vigenciaMs = 60_000 })`, que guarda:
  - `ultimo`: el último saldo bueno con `leidoEn`.
  - `enCurso`: la promesa de la consulta en curso, si la hay.
- **`obtener()`**:
  1. Sin cliente → `{ estado: 'no_configurado' }`.
  2. Si `ultimo` existe y `ahora() - leidoEn < 60_000` → lo devuelve. Con exactamente 60 000 ms ya está vencido (es lo que fijan los escenarios de borde).
  3. Si hay `enCurso`, espera esa misma promesa: varias pantallas a la vez hacen **una** consulta.
  4. Si no, consulta. Si sale bien, actualiza `ultimo` con `leidoEn = ahora()` (el instante en que llegó la respuesta).
  5. Si falla, **no** toca `ultimo`: devuelve `ultimo` con `desactualizado: true` y el motivo, o `{ estado: 'no_disponible', motivo }` si nunca hubo uno. Las fallas no se guardan, así que el próximo pedido vuelve a intentar.
- Una sola instancia de la app (como el resto del sistema), así que la caché en memoria alcanza. Un reinicio solo hace que la primera consulta vaya a MP.
- **Por qué 60 s:** las pantallas refrescan cada 60 s; con tres pantallas abiertas (mostrador, dashboard y celular) son como mucho unas 60 consultas por hora a MP, muy lejos de cualquier límite. El saldo cambia con cada cobro, así que más de un minuto lo haría poco útil en el mostrador.
- Alternativa descartada: guardar el saldo en la base. No hace falta historial y suma una migración más en una etapa con varios cambios en paralelo.
- Alternativa descartada: consultar MP con una tarea periódica. Consultaría aunque nadie mire; la caché a demanda solo consulta cuando alguien abre una pantalla.

### Forma de la respuesta (`packages/shared/src/mercadopago.ts`)
```
SaldoMercadoPago =
  | { estado: 'no_configurado' }
  | { estado: 'no_disponible'; motivo: 'no_responde' | 'credenciales' | 'rechazo' }
  | { estado: 'disponible'; disponible: Monto; aLiberar: Monto | null; leidoEn: ISO;
      desactualizado: boolean; motivo?: 'no_responde' | 'credenciales' | 'rechazo' }
```
- `textoSaldoNoDisponible(motivo)` en shared, para que las tres pantallas digan lo mismo.

### Ruta `GET /api/mercado-pago/saldo`
- En `modules/mercadopago/rutas.ts`, con sesión, para **admin y empleado**. El prefijo `/api/mercado-pago` entra a `PREFIJOS_ADMIN` de `rutas-protegidas.test.ts`, con `GET /api/mercado-pago/saldo` en `RUTAS_DEL_EMPLEADO`.
- `crearApp` recibe `mercadoPago?: ClienteMercadoPago`. Sin él, el saldo es `no_configurado`. `server.ts` crea el cliente solo si hay `MP_ACCESS_TOKEN`.
- `GET /api/health` no consulta MP.

### Pantallas
- **Qué se destaca (decidido por el dueño el 2026-11-11):** el **disponible** en grande y lo **a liberar** chico debajo, en las tres pantallas.
- **Dashboard:** el saldo se pide con su propia consulta (`GET /api/mercado-pago/saldo`) y se muestra en la fila de "ahora", junto al efectivo en caja. **No se suma a `GET /api/dashboard`**: así una demora de MP de hasta 10 s no demora el resto del dashboard, y `modules/dashboard/servicio.ts` no cambia (menos choques con `cobro-mercado-pago`).
- **Administración → Mercado Pago:** tarjeta del saldo arriba del formulario, con la hora y un botón **Actualizar**. Se saca el texto "el saldo llega en la Etapa 5". **Actualizar** usa la misma ruta: respeta la caché, para que tocarlo varias veces no consulte a MP de más.
- **Caja (F8):** una línea "Mercado Pago: $ 250.000,00 (10:00)" arriba de los movimientos del turno. Si no está configurado, la línea no aparece.
- En las tres: React Query con `refetchInterval` y `staleTime` de 60 s; "desactualizado" se muestra en gris con la hora de la última lectura buena y el motivo (decidido por el dueño el 2026-11-11), con los mismos textos de `textoSaldoNoDisponible` sin el prefijo "Saldo no disponible: " ("Mercado Pago no responde", "Mercado Pago rechazó las credenciales").
- **Caja (F8) solo existe con un turno abierto** (decidido por el dueño el 2026-11-11): un empleado sin turno abierto no ve el saldo; no se agrega otra pantalla.

### Configuración
- `MP_ACCESS_TOKEN` opcional (`z.string().min(1)`): definida y vacía no arranca. Los errores nombran la variable, nunca el valor, como ya hace `cargarConfig`.
- `cobro-mercado-pago` suma sus variables con la regla "juntas o ninguna" y la exigencia de que tengan el token.
- `apps/api/.env.example` e `infra/.env.example` suman `MP_ACCESS_TOKEN` comentada.

### Archivos compartidos con los otros cambios en curso

| Archivo | Qué toca este cambio | `cobro-mercado-pago` | `aviso-reposicion-diario` | `facturacion-arca` |
|---|---|---|---|---|
| `apps/api/prisma/schema.prisma` y migraciones | **Nada** | Enum `EstadoVenta`, modelos de cobro; su migración | `EjecucionTarea`, valor `reposicion`; migración `aviso_reposicion` | Sus modelos y migración |
| `apps/api/src/config.ts` | `MP_ACCESS_TOKEN` | `MP_TERMINAL_ID`, `MP_WEBHOOK_SECRET` (con la regla "juntas o ninguna") | Nada | Sus variables de ARCA |
| `apps/api/.env.example`, `infra/.env.example` | `MP_ACCESS_TOKEN` comentada | Sus variables, debajo | Nada | Sus variables, en bloque aparte |
| `apps/api/src/server.ts` | Crea el cliente de MP si hay token | Arranca la tarea de cobros con `iniciarCiclo` | Arranca la tarea del aviso | Su tarea, si la tiene |
| `apps/api/src/app.ts` | `mercadoPago?` en `OpcionesApp` y registro de `rutasMercadoPago` | Rutas de cobro y webhook en el mismo módulo | Nada | Sus rutas |
| `apps/web/src/admin/PanelAdmin.tsx` | Nada (la tarjeta de MP ya existe) | Nada | Nada | Su tarjeta |
| `apps/web/src/app/rutas.tsx` | Nada | Nada | Nada | Sus pantallas |
| `packages/shared/src/index.ts` | Exporta `mercadopago.ts` | Exporta lo de cobro desde el mismo archivo | Nada | Exporta lo suyo |
| `packages/shared/src/ventas.ts` | Nada | `pendiente` y `cancelada` en `ESTADOS_VENTA` | `reposicion` en `TIPOS_NOTIFICACION` | Sus datos de factura |
| `apps/web/src/pos/Venta.tsx`, `Ticket.tsx` | Nada | Pantalla de espera del cobro | Nada | Datos de la factura en el ticket |
| `apps/web/src/pos/Caja.tsx` | Línea del saldo en F8 | Aviso de cobro en espera al cerrar el turno | Nada | Nada |
| `modules/ventas/servicio.ts`, `caja/servicio.ts`, `dashboard/servicio.ts` | **Nada** | Sí (ver su design) | Nada | `ventas/servicio.ts` |
| `apps/web/src/admin/Dashboard.tsx` | Tarjeta del saldo | Nada | Nada | Nada |

- **Orden recomendado de merge:** `aviso-reposicion-diario` (crea `src/jobs/`), este cambio (crea `src/integrations/mercadopago/`), `facturacion-arca` y después `cobro-mercado-pago`. Este cambio no tiene migración, así que no afecta el orden de las migraciones. **Tiene que entrar antes que `cobro-mercado-pago`**, que usa su integración y `MP_ACCESS_TOKEN`. El design de `facturacion-arca` lo pone último, y eso no funciona. Con `facturacion-arca` solo comparte `config.ts` (su ayudante `todasONinguna` sirve igual para `MP_ACCESS_TOKEN`).
- **Requisitos:** no modifica ningún requisito que modifiquen `cobro-mercado-pago` ni `facturacion-arca`. En `dashboard` modifica "Efectivo en caja y pendiente de pagar" (el cobro solo agrega uno nuevo) y en `caja` agrega uno nuevo.

## Risks / Trade-offs

- **[El endpoint de saldo no está en la documentación oficial y puede no funcionar o dejar de existir]** → Queda aislado en `cliente.saldo()` y marcado para probar con credenciales reales. Si falla, se pasa al plan B sin cambiar las pantallas.
- **[El saldo de MP incluye comisiones, retenciones y movimientos hechos fuera del sistema]** → Es lo buscado: se muestra lo que dice MP, no lo que el sistema cree. Por eso no se compara con los movimientos.
- **[Las credenciales de prueba pueden no tener saldo o no exponer el recurso]** → La prueba que vale es con la cuenta real del kiosco; con la de prueba se verifica que la integración no se rompe.
- **[Un token con permisos de más]** → El token de la aplicación del kiosco ya puede cobrar; este cambio solo lee. Vive en `infra/.env` (fuera del repo) y nunca sale del servidor.

## Plan B (si la opción A no funciona con credenciales reales)

- **B-manual (recomendado):** el admin carga desde Administración → Mercado Pago el saldo que ve en la app ("saldo de referencia" con fecha y hora). El sistema muestra ese saldo más los cobros de MP aprobados por el sistema y los ingresos, menos los gastos, retiros y pagos a proveedores de la cuenta MP, desde esa hora. Desde `cobro-mercado-pago` **todo cobro de MP pasa por el sistema** (no hay transferencias por alias), así que la diferencia con MP serían solo comisiones y retenciones; el admin las corrige cargando un nuevo saldo de referencia. Es el "ajuste manual" del design archivado de `cuenta-mercado-pago`.
- **B-reporte:** pedir el reporte "Dinero liberado" por API y tomar `initial_available_balance` más los movimientos. Es automático pero llega con minutos de demora y es más complejo de leer.
- Cualquiera de los dos es un cambio aparte. Los estados del spec (`disponible`, `no_disponible`, `desactualizado`) se mantienen.

## Migration Plan

1. Sin migración de base.
2. Primer deploy: sin `MP_ACCESS_TOKEN` todo sigue igual y el saldo dice "Mercado Pago no configurado". Para activarlo, el dueño carga el token de producción en `infra/.env` y se reinicia la app.
3. **Vuelta atrás:** `deploy.sh` a la versión anterior. No hay datos que migrar.

## Open Questions

1. **¿El recurso de saldo funciona con la cuenta del kiosco?** Se responde con la prueba con credenciales reales (tarea 6.1). Si no: plan **B-manual** (recomendado) o **B-reporte**, como cambio aparte.
2. **¿El empleado tiene que ver el monto exacto?** Decisión del dueño: sí. Se deja anotado por si después prefiere ocultarlo: sería sacar la ruta de `RUTAS_DEL_EMPLEADO` y la línea de F8.
