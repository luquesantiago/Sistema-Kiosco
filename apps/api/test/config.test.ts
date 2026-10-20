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
