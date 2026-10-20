# Infraestructura

Por ahora solo hay un Compose de **desarrollo** con PostgreSQL. El Compose de producción (`caddy`, `app`, `db`, `waha`), el deploy y los backups llegan con la puesta en marcha (Etapa 2).

## Base de datos de desarrollo

`docker-compose.dev.yml` levanta PostgreSQL 18 escuchando solo en `127.0.0.1`, con dos bases:

| Base | Uso | URL |
|---|---|---|
| `kiosco` | desarrollo (`apps/api/.env`) | `postgresql://kiosco:kiosco@localhost:5432/kiosco` |
| `kiosco_test` | tests de la API | `postgresql://kiosco:kiosco@localhost:5432/kiosco_test` |

`kiosco_test` la crea `db/init/01-test-db.sql` la primera vez que se inicializa el volumen.

Desde la raíz del repositorio:

```bash
pnpm db:up
```

Levanta el contenedor y espera a que la base esté lista.

```bash
pnpm db:down
```

Detiene y borra el contenedor. Los datos quedan en el volumen.

Para **resetear** la base (borra todos los datos de desarrollo y de test):

```bash
docker compose -f infra/docker-compose.dev.yml down -v
```

Después, `pnpm db:up` la recrea vacía, incluida `kiosco_test`.

## Puerto ocupado

Si el puerto 5432 ya lo usa otro PostgreSQL, levantá la base en otro puerto y ajustá las URLs:

```bash
DB_PORT=5433 pnpm db:up
```

- En `apps/api/.env`, cambiá el puerto de `DATABASE_URL` a `5433`.
- Para los tests, definí `TEST_DATABASE_URL` con el mismo puerto.
