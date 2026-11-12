import { expect, test, type Page } from '@playwright/test';
import { ALFAJOR, GASEOSA } from './datos.js';

async function ingresar(page: Page, usuario: string, contrasena: string) {
  await page.goto('/ingresar');
  await page.getByLabel('Usuario').fill(usuario);
  await page.getByLabel('Contraseña').fill(contrasena);
  await page.getByLabel('Contraseña').press('Enter');
  await expect(page).not.toHaveURL(/\/ingresar$/);
}

/** Escribe el código y Enter, como el lector. */
async function escanear(page: Page, codigo: string) {
  const campo = page.getByRole('combobox', { name: 'Escaneá o buscá un producto' });
  await expect(campo).toBeFocused();
  await page.keyboard.type(codigo);
  await page.keyboard.press('Enter');
  await expect(campo).toHaveValue('');
}

/** Si la caja pide abrir el turno, lo abre con el monto sugerido (Enter). */
async function asegurarTurnoPropio(page: Page) {
  const escaner = page.getByRole('combobox', { name: 'Escaneá o buscá un producto' });
  const apertura = page.getByRole('heading', { name: 'Abrir turno' });
  await expect(escaner.or(apertura)).toBeVisible();
  if (await apertura.isVisible()) {
    await expect(page.getByLabel('Efectivo en la caja')).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(escaner).toBeFocused();
}

async function salir(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
}

async function stockDe(page: Page, codigo: string): Promise<number> {
  const res = await page.request.get(`/api/productos?q=${codigo}`);
  const [producto] = (await res.json()) as { stockActual: number }[];
  return producto!.stockActual;
}

test('flujo del mostrador: escanear, cobrar con vuelto, anular y avisar al admin', async ({
  page,
  context,
}) => {
  await ingresar(page, 'e2e-empleado', process.env.E2E_CLAVE_EMPLEADO!);
  await expect(page).toHaveURL(/\/venta$/);
  await asegurarTurnoPropio(page);

  // F1 a F4 con el carrito vacío: avisan y no disparan nada del navegador (F1 = ayuda de Chrome).
  for (const tecla of ['F1', 'F2', 'F3', 'F4']) {
    await page.keyboard.press(tecla);
    await expect(page.getByRole('alert')).toHaveText('El carrito está vacío.');
  }
  expect(context.pages()).toHaveLength(1);
  await expect(page).toHaveURL(/\/venta$/);

  // Dos alfajores (uno repetido) y una gaseosa: $3.300.
  await escanear(page, ALFAJOR.codigo);
  await escanear(page, GASEOSA.codigo);
  await escanear(page, ALFAJOR.codigo);
  const carrito = page.getByRole('table', { name: 'Carrito' });
  await expect(carrito.getByRole('row', { name: /Alfajor triple/ })).toContainText('2');
  await expect(page.getByTestId('total')).toHaveText(/3\.300,00/);

  // F1, paga con $5.000 y ve el vuelto.
  await page.keyboard.press('F1');
  const cobro = page.getByRole('dialog', { name: 'Cobro en Efectivo' });
  await expect(cobro.getByLabel('Paga con (opcional)')).toBeFocused();
  await page.keyboard.type('5000');
  await expect(cobro.getByRole('status')).toContainText('1.700,00');
  await page.keyboard.press('Enter');

  const ultima = page.getByRole('region', { name: 'Última venta' });
  await expect(ultima).toContainText('Vuelto: $ 1.700,00');
  const numero = (await ultima.textContent())!.match(/Venta #(\d+)/)![1]!;
  expect(await stockDe(page, ALFAJOR.codigo)).toBe(ALFAJOR.stock - 2);
  expect(await stockDe(page, GASEOSA.codigo)).toBe(GASEOSA.stock - 1);

  // La venta aparece en el listado del día y se anula con motivo.
  await page.goto('/ventas');
  await page
    .getByRole('link', { name: `#${numero}` })
    .first()
    .click();
  await page.getByRole('button', { name: 'Anular venta' }).click();
  await page.getByLabel('Motivo de la anulación').fill('cobré dos veces');
  await page.getByRole('button', { name: 'Confirmar anulación' }).click();
  await expect(page.getByText(/por Empleado E2E: cobré dos veces/)).toBeVisible();
  expect(await stockDe(page, ALFAJOR.codigo)).toBe(ALFAJOR.stock);
  expect(await stockDe(page, GASEOSA.codigo)).toBe(GASEOSA.stock);

  // El admin ve el aviso pendiente.
  await salir(page);
  await ingresar(page, 'e2e-admin', process.env.E2E_CLAVE_ADMIN!);
  await page.goto('/admin/avisos');
  const avisos = page.getByRole('list', { name: 'Avisos' });
  await expect(avisos).toContainText(`Venta #${numero} anulada`);
  await expect(avisos).toContainText('Motivo: cobré dos veces');
  await expect(avisos).toContainText('Pendiente de envío');
});

test('cambio de turno: cierre con retiro, apertura con lo que quedó y turno olvidado', async ({
  page,
}) => {
  const clave = process.env.E2E_CLAVE_EMPLEADO!;

  // Empleado E2E vende en efectivo, registra un gasto y cierra con retiro.
  await ingresar(page, 'e2e-empleado', clave);
  await page.goto('/venta');
  await asegurarTurnoPropio(page);
  await escanear(page, ALFAJOR.codigo);
  await page.keyboard.press('F1');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Última venta' })).toBeVisible();

  await page.keyboard.press('F8');
  const caja = page.getByRole('dialog', { name: 'Caja' });
  await expect(caja.getByLabel('Monto')).toBeFocused();
  await page.keyboard.type('100');
  // La categoría se elige con teclado: Tab entra al grupo y la flecha elige.
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowRight');
  await expect(caja.getByRole('radio', { name: 'Insumos' })).toBeChecked();
  await caja.getByLabel('Motivo').fill('Hielo');
  await page.keyboard.press('Enter');
  await expect(caja.getByRole('list', { name: 'Movimientos del turno' })).toContainText(
    'Gasto · Insumos: Hielo',
  );
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Cerrar turno' }).click();
  const cierre = page.getByRole('dialog', { name: 'Cerrar turno' });
  await expect(cierre).not.toContainText(/esperado/i);
  await page.keyboard.type('1000');
  await cierre.getByLabel('Retiro al cerrar (opcional)').fill('500');
  await cierre.getByLabel('Motivo del retiro').fill('Al banco');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('quedo-en-caja')).toHaveText(/500,00/);
  await expect(page.getByRole('button', { name: 'Cerrar sesión (Enter)' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/ingresar$/);

  // Segunda E2E abre con lo que quedó, vende y se va sin cerrar.
  await ingresar(page, 'e2e-segunda', clave);
  await expect(page.getByLabel('Efectivo en la caja')).toHaveValue('500,00');
  await page.keyboard.press('Enter');
  await escanear(page, GASEOSA.codigo);
  await page.keyboard.press('F2');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Última venta' })).toBeVisible();
  await salir(page);

  // Empleado E2E vuelve, cierra el turno de Segunda E2E y abre el suyo.
  await ingresar(page, 'e2e-empleado', clave);
  await expect(
    page.getByRole('heading', { name: 'El turno de Segunda E2E está abierto' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar turno de Segunda E2E' }).click();
  await page.keyboard.type('500');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Abrir mi turno (Enter)' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Efectivo en la caja')).toHaveValue('500,00');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Escaneá o buscá un producto' })).toBeFocused();
  await salir(page);

  // El admin ve los turnos con quién cerró y los avisos de gasto y de cierre.
  await ingresar(page, 'e2e-admin', process.env.E2E_CLAVE_ADMIN!);
  await page.goto('/admin/turnos');
  const turnos = page.getByRole('list', { name: 'Turnos' });
  await expect(turnos.getByRole('listitem').first()).toContainText('Abierto');
  await expect(turnos).toContainText('cerró Empleado E2E');
  await page.goto('/admin/avisos');
  const avisos = page.getByRole('list', { name: 'Avisos' });
  await expect(avisos).toContainText('Gasto de caja');
  await expect(avisos).toContainText('Motivo: Hielo');
  await expect(avisos).toContainText('Cerró: Empleado E2E (en nombre de Segunda E2E)');
  await expect(avisos).toContainText('Retiro al cierre');
});
