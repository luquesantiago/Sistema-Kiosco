import type { VentaDetalle } from '@kiosco/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Ticket } from '../src/pos/Ticket.js';
import {
  EMISOR,
  facturaAutorizada,
  facturaSinAutorizar,
  PAGOS_MIXTOS,
  ventaDetalle,
} from './factura-datos.js';

/*
 * Ticket con factura (specs/punto-de-venta: "Ticket de una venta facturada",
 * "Bloque fiscal por factura", "Imprimir con la factura en trámite" y "Ticket a pedido").
 *
 * Contrato que asume este test (lo más simple que pide el design):
 * - Cada `BloqueFactura` lleva `data-testid="bloque-factura"` y su QR es un `<svg>` adentro.
 * - El CUIT se imprime como `20-12345678-6`, después de la razón social y un "–".
 * Los importes se buscan con o sin espacio después del "$" (Intl usa uno duro).
 */

function imprimir(venta: ReturnType<typeof ventaDetalle>) {
  render(<Ticket venta={venta as unknown as VentaDetalle} />);
  return screen.getByTestId('ticket');
}

const pesos = (texto: string) => texto.replace('$', '\\$\\s?').replace(/\./g, '\\.');
const conPesos = (patron: string) => new RegExp(pesos(patron));

describe('ticket de una venta 100% electrónica facturada', () => {
  const VENTA = ventaDetalle({
    facturas: [facturaAutorizada(42, '3300.00')],
    sinFacturar: '0.00',
  });

  it('arriba el nombre de fantasía en grande y debajo la razón social con el CUIT, antes de la venta', () => {
    const ticket = imprimir(VENTA);
    const texto = ticket.textContent ?? '';

    expect(ticket).toHaveTextContent(/Pérez Juan\s*–\s*CUIT 20-12345678-6/);
    const nombre = texto.indexOf('Kiosco Las Flores');
    const razon = texto.indexOf('Pérez Juan');
    const venta = texto.indexOf('Venta #120');
    expect(nombre).toBeGreaterThanOrEqual(0);
    expect(nombre).toBeLessThan(razon);
    expect(razon).toBeLessThan(venta);
    // "En grande": es el título del ticket.
    expect(screen.getByText('Kiosco Las Flores')).toHaveClass('ticket-titulo');
  });

  it('un bloque fiscal con FACTURA C, Cód. 011, número, "Facturado: $3.300,00", CAE, vencimiento y QR', () => {
    const ticket = imprimir(VENTA);

    const bloques = within(ticket).getAllByTestId('bloque-factura');
    expect(bloques).toHaveLength(1);
    const bloque = bloques[0]!;
    for (const texto of ['FACTURA C', 'Cód. 011', '00005-00000042', '76451234567892']) {
      expect(bloque).toHaveTextContent(texto);
    }
    expect(bloque).toHaveTextContent(conPesos('Facturado: $3.300,00'));
    expect(bloque).toHaveTextContent('Vto. CAE: 20/11/2026');
    expect(bloque).toHaveTextContent('10/11/2026');
    expect(bloque.querySelector('svg')).not.toBeNull();
  });

  it('una sola vez: domicilio, IIBB, inicio de actividades, "Responsable Monotributo" y "Consumidor final"; sin "No válido como factura"', () => {
    const ticket = imprimir(VENTA);
    const texto = ticket.textContent ?? '';

    for (const dato of [
      EMISOR.domicilio,
      EMISOR.iibb,
      '01/03/2020',
      'Responsable Monotributo',
      'Consumidor final',
    ]) {
      expect(texto.split(dato).length - 1, dato).toBe(1);
    }
    expect(ticket).not.toHaveTextContent('No válido como factura');
    expect(ticket).not.toHaveTextContent('Sin facturar');
    expect(ticket).not.toHaveTextContent('SIN VALIDEZ FISCAL');
  });

  it('sigue llevando los ítems, el total y los pagos', () => {
    const ticket = imprimir(VENTA);

    expect(ticket).toHaveTextContent('Varios');
    expect(ticket).toHaveTextContent('TOTAL');
    expect(ticket).toHaveTextContent('Débito');
    expect(ticket).toHaveTextContent(conPesos('$3.300,00'));
  });
});

describe('ticket de una venta mixta', () => {
  it('con la automática autorizada: total $5.000, los dos pagos, un bloque "Facturado: $3.000,00" y "Sin facturar: $2.000,00 – no válido como factura"', () => {
    const ticket = imprimir(
      ventaDetalle({
        total: '5000.00',
        pagos: PAGOS_MIXTOS,
        facturas: [facturaAutorizada(42, '3000.00')],
        sinFacturar: '2000.00',
        puedePedirFactura: true,
      }),
    );

    expect(ticket).toHaveTextContent(conPesos('$5.000,00'));
    expect(ticket).toHaveTextContent('Efectivo');
    expect(ticket).toHaveTextContent('Débito');
    const bloques = within(ticket).getAllByTestId('bloque-factura');
    expect(bloques).toHaveLength(1);
    expect(bloques[0]).toHaveTextContent(conPesos('Facturado: $3.000,00'));
    expect(bloques[0]!.querySelector('svg')).not.toBeNull();
    expect(ticket).toHaveTextContent(conPesos('Sin facturar: $2.000,00 – no válido como factura'));
  });

  it('con las dos autorizadas: dos bloques con su número, importe, CAE y QR, y sin "Sin facturar"', () => {
    const ticket = imprimir(
      ventaDetalle({
        total: '5000.00',
        pagos: PAGOS_MIXTOS,
        facturas: [facturaAutorizada(42, '3000.00'), facturaAutorizada(43, '2000.00', 'efectivo')],
        sinFacturar: '0.00',
      }),
    );

    const bloques = within(ticket).getAllByTestId('bloque-factura');
    expect(bloques).toHaveLength(2);
    expect(bloques[0]).toHaveTextContent('00005-00000042');
    expect(bloques[0]).toHaveTextContent(conPesos('Facturado: $3.000,00'));
    expect(bloques[0]).toHaveTextContent('76451234567892');
    expect(bloques[1]).toHaveTextContent('00005-00000043');
    expect(bloques[1]).toHaveTextContent(conPesos('Facturado: $2.000,00'));
    expect(bloques[1]).toHaveTextContent('76451234567893');
    for (const b of bloques) expect(b.querySelector('svg')).not.toBeNull();
    expect(ticket).not.toHaveTextContent('Sin facturar');
    expect(ticket).not.toHaveTextContent('No válido como factura');
    // Los datos del emisor van una sola vez, aunque haya dos bloques.
    expect((ticket.textContent ?? '').split('Responsable Monotributo').length - 1).toBe(1);
  });

  it('con la automática autorizada y la del efectivo en trámite: el bloque y la línea de trámite, sin "Sin facturar"', () => {
    const ticket = imprimir(
      ventaDetalle({
        total: '5000.00',
        pagos: PAGOS_MIXTOS,
        facturas: [facturaAutorizada(42, '3000.00'), facturaSinAutorizar('2000.00', 'efectivo')],
        sinFacturar: '2000.00',
      }),
    );

    expect(within(ticket).getAllByTestId('bloque-factura')).toHaveLength(1);
    expect(ticket).toHaveTextContent(
      conPesos('Factura en trámite: $2.000,00 – pedila de nuevo desde Ventas'),
    );
    expect(ticket).not.toHaveTextContent('Sin facturar');
  });
});

describe('ticket con la factura sin autorizar', () => {
  it.each(['pendiente', 'en_curso'] as const)(
    'factura %s: la línea "Factura en trámite" con su importe, sin bloque ni QR',
    (estado) => {
      const ticket = imprimir(
        ventaDetalle({ facturas: [facturaSinAutorizar('3300.00', 'electronica', estado)] }),
      );

      expect(ticket).toHaveTextContent(
        conPesos('Factura en trámite: $3.300,00 – pedila de nuevo desde Ventas'),
      );
      expect(within(ticket).queryAllByTestId('bloque-factura')).toEqual([]);
      expect(ticket.querySelector('svg')).toBeNull();
      expect(ticket).toHaveTextContent('No válido como factura');
    },
  );

  it.each(['error', 'cancelada'] as const)(
    'única factura %s: el ticket de siempre, con "No válido como factura"',
    (estado) => {
      const ticket = imprimir(
        ventaDetalle({ facturas: [facturaSinAutorizar('3300.00', 'electronica', estado)] }),
      );

      expect(ticket).toHaveTextContent('No válido como factura');
      expect(within(ticket).queryAllByTestId('bloque-factura')).toEqual([]);
      expect(ticket).not.toHaveTextContent('Factura en trámite');
      expect(ticket).not.toHaveTextContent('Kiosco Las Flores');
      expect(ticket).not.toHaveTextContent('CUIT');
    },
  );

  it('venta en efectivo sin factura: el ticket de siempre, con "No válido como factura"', () => {
    const ticket = imprimir(
      ventaDetalle({
        pagos: [{ medio: 'efectivo', monto: '3300.00' }],
        puedePedirFactura: true,
      }),
    );

    expect(ticket).toHaveTextContent('No válido como factura');
    expect(ticket).toHaveTextContent('Venta #120');
    expect(within(ticket).queryAllByTestId('bloque-factura')).toEqual([]);
    expect(ticket).not.toHaveTextContent('Sin facturar');
  });
});

describe('homologación', () => {
  it('cada bloque dice "HOMOLOGACIÓN – SIN VALIDEZ FISCAL"', () => {
    const ticket = imprimir(
      ventaDetalle({
        total: '5000.00',
        pagos: PAGOS_MIXTOS,
        facturas: [facturaAutorizada(42, '3000.00'), facturaAutorizada(43, '2000.00', 'efectivo')],
        sinFacturar: '0.00',
        emisor: { ...EMISOR, entorno: 'homologacion' },
      }),
    );

    for (const bloque of within(ticket).getAllByTestId('bloque-factura')) {
      expect(bloque).toHaveTextContent('HOMOLOGACIÓN – SIN VALIDEZ FISCAL');
    }
  });

  it('en producción no aparece la marca', () => {
    const ticket = imprimir(
      ventaDetalle({ facturas: [facturaAutorizada(42, '3300.00')], sinFacturar: '0.00' }),
    );

    expect(ticket).not.toHaveTextContent('HOMOLOGACIÓN');
  });
});
