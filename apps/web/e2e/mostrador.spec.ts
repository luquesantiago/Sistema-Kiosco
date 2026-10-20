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
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/ingresar$/);
  await ingresar(page, 'e2e-admin', process.env.E2E_CLAVE_ADMIN!);
  await page.goto('/admin/avisos');
  const avisos = page.getByRole('list', { name: 'Avisos' });
  await expect(avisos).toContainText(`Venta #${numero} anulada`);
  await expect(avisos).toContainText('Motivo: cobré dos veces');
  await expect(avisos).toContainText('Pendiente de envío');
});
