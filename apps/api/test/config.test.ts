import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../src/config.js';

describe('cargarConfig', () => {
  it('acepta una configuración válida y completa los valores por defecto', () => {
    const resultado = cargarConfig({ DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco' });
    expect(resultado).toEqual({
      ok: true,
      config: {
        DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco',
        PORT: 3000,
        NODE_ENV: 'development',
        LOG_LEVEL: 'info',
      },
    });
  });

  it('rechaza la configuración sin DATABASE_URL y nombra la variable', () => {
    const resultado = cargarConfig({ PORT: '3000', LOG_LEVEL: 'debug' });
    expect(resultado).toEqual({ ok: false, errores: ['DATABASE_URL: falta la variable'] });
  });

  it('acepta WhatsApp configurado con URL y clave', () => {
    const resultado = cargarConfig({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco',
      WAHA_URL: 'http://waha:3000',
      WAHA_API_KEY: 'clave',
    });
    expect(resultado).toMatchObject({
      ok: true,
      config: { WAHA_URL: 'http://waha:3000', WAHA_API_KEY: 'clave' },
    });
  });

  it('rechaza WhatsApp a medias y nombra la variable que falta', () => {
    const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco' };
    expect(cargarConfig({ ...base, WAHA_URL: 'http://waha:3000' })).toEqual({
      ok: false,
      errores: ['WAHA_API_KEY: falta la variable'],
    });
    expect(cargarConfig({ ...base, WAHA_API_KEY: 'clave-secreta' })).toEqual({
      ok: false,
      errores: ['WAHA_URL: falta la variable'],
    });
  });

  describe('MP_ACCESS_TOKEN (opcional)', () => {
    const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco' };

    it('ausente: arranca sin Mercado Pago', () => {
      const resultado = cargarConfig(base);
      expect(resultado.ok).toBe(true);
      expect(resultado.ok && resultado.config).not.toHaveProperty('MP_ACCESS_TOKEN');
    });

    it('definida pero vacía: no arranca y nombra la variable como valor inválido', () => {
      expect(cargarConfig({ ...base, MP_ACCESS_TOKEN: '' })).toEqual({
        ok: false,
        errores: ['MP_ACCESS_TOKEN: valor inválido'],
      });
    });

    it('con un carácter: arranca y la guarda', () => {
      expect(cargarConfig({ ...base, MP_ACCESS_TOKEN: 'x' })).toMatchObject({
        ok: true,
        config: { MP_ACCESS_TOKEN: 'x' },
      });
    });

    it('con un token completo: arranca y la guarda', () => {
      const token = 'APP_USR-1234567890-111111-abcdef-222222';
      expect(cargarConfig({ ...base, MP_ACCESS_TOKEN: token })).toMatchObject({
        ok: true,
        config: { MP_ACCESS_TOKEN: token },
      });
    });

    it('si otra variable es inválida, el error no muestra el token', () => {
      const token = 'APP_USR-token-secreto';
      const resultado = cargarConfig({ ...base, PORT: 'no-es-puerto', MP_ACCESS_TOKEN: token });
      expect(resultado.ok).toBe(false);
      expect(JSON.stringify(resultado)).not.toContain(token);
    });
  });

  it('no incluye los valores recibidos en los errores', () => {
    const resultado = cargarConfig({
      DATABASE_URL: 'mysql://usuario:secreto@host/db',
      PORT: 'puerto-secreto',
    });
    expect(resultado.ok).toBe(false);
    const texto = JSON.stringify(resultado);
    expect(texto).toContain('DATABASE_URL: valor inválido');
    expect(texto).toContain('PORT: valor inválido');
    expect(texto).not.toContain('secreto');
  });
});

describe('cargarConfig: facturación con ARCA (todas juntas o ninguna)', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/kiosco' };
  const CUIT = '20123456786';
  const ARCA = {
    ARCA_CUIT: CUIT,
    ARCA_PUNTO_VENTA: '5',
    ARCA_ENTORNO: 'homologacion',
    ARCA_CERT_PATH: '/run/secrets/arca/certificado.crt',
    ARCA_KEY_PATH: '/run/secrets/arca/clave.key',
    ARCA_NOMBRE_FANTASIA: 'Kiosco Las Flores',
    ARCA_RAZON_SOCIAL: 'Pérez Juan',
    ARCA_DOMICILIO: 'Av. Rivadavia 1234, Morón',
    ARCA_INICIO_ACTIVIDADES: '2020-03-01',
    ARCA_IIBB: 'Exento',
  };
  const VARIABLES = Object.keys(ARCA) as (keyof typeof ARCA)[];

  function sin(variable: keyof typeof ARCA) {
    const { [variable]: _quitada, ...resto } = ARCA;
    return resto;
  }

  it('sin ninguna variable ARCA_* arranca sin facturación', () => {
    const resultado = cargarConfig(base);
    expect(resultado.ok).toBe(true);
    const claves = resultado.ok ? Object.keys(resultado.config) : [];
    expect(claves.filter((c) => c.startsWith('ARCA_'))).toEqual([]);
  });

  it('con todas arranca, con el punto de venta como número', () => {
    expect(cargarConfig({ ...base, ...ARCA })).toMatchObject({
      ok: true,
      config: { ...ARCA, ARCA_PUNTO_VENTA: 5 },
    });
  });

  it.each(VARIABLES)('si falta solo %s, no arranca y la nombra sin mostrar el CUIT', (variable) => {
    const resultado = cargarConfig({ ...base, ...sin(variable) });

    expect(resultado).toEqual({ ok: false, errores: [`${variable}: falta la variable`] });
    expect(JSON.stringify(resultado)).not.toContain(CUIT);
  });

  it('con el CUIT y el punto de venta pero sin la clave, el error nombra ARCA_KEY_PATH sin mostrar el CUIT', () => {
    const resultado = cargarConfig({ ...base, ARCA_CUIT: CUIT, ARCA_PUNTO_VENTA: '5' });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok ? [] : resultado.errores).toContain('ARCA_KEY_PATH: falta la variable');
    expect(JSON.stringify(resultado)).not.toContain(CUIT);
  });

  it.each([
    ['0', false],
    ['1', true],
    ['99999', true],
    ['100000', false],
  ])('punto de venta %s → arranca: %s', (puntoVenta, arranca) => {
    const resultado = cargarConfig({ ...base, ...ARCA, ARCA_PUNTO_VENTA: puntoVenta });

    if (arranca) {
      expect(resultado).toMatchObject({ ok: true, config: { ARCA_PUNTO_VENTA: Number(puntoVenta) } });
    } else {
      expect(resultado).toEqual({ ok: false, errores: ['ARCA_PUNTO_VENTA: valor inválido'] });
    }
  });

  it.each([
    ['dígito verificador inválido', '20123456787'],
    ['10 dígitos', '2012345678'],
    ['12 dígitos', '201234567860'],
    ['con guiones', '20-12345678-6'],
  ])('CUIT con %s → no arranca y no muestra el valor', (_caso, cuit) => {
    const resultado = cargarConfig({ ...base, ...ARCA, ARCA_CUIT: cuit });

    expect(resultado).toEqual({ ok: false, errores: ['ARCA_CUIT: valor inválido'] });
    expect(JSON.stringify(resultado)).not.toContain(cuit);
  });

  it.each([
    ['homologacion', true],
    ['produccion', true],
    ['testing', false],
    ['Produccion', false],
    ['producción', false],
  ])('ARCA_ENTORNO=%s → arranca: %s', (entorno, arranca) => {
    const resultado = cargarConfig({ ...base, ...ARCA, ARCA_ENTORNO: entorno });

    if (arranca) {
      expect(resultado).toMatchObject({ ok: true, config: { ARCA_ENTORNO: entorno } });
    } else {
      expect(resultado).toEqual({ ok: false, errores: ['ARCA_ENTORNO: valor inválido'] });
    }
  });

  it('el inicio de actividades va como AAAA-MM-DD', () => {
    expect(cargarConfig({ ...base, ...ARCA, ARCA_INICIO_ACTIVIDADES: '01/03/2020' })).toEqual({
      ok: false,
      errores: ['ARCA_INICIO_ACTIVIDADES: valor inválido'],
    });
  });
});
