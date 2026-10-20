import { describe, expect, it, vi } from 'vitest';
import { configurarAlNoAutenticado, ErrorDeApi, pedir } from '../src/api/cliente.js';
import { simularApi, SIN_SESION } from './ayudas.js';

describe('cliente de la API', () => {
  it('devuelve el JSON de una respuesta correcta y manda el body como JSON', async () => {
    const fetchMock = simularApi({ 'POST /usuarios': (cuerpo) => [201, { recibido: cuerpo }] });

    const res = await pedir('POST', '/usuarios', { nombre: 'Juan' });

    expect(res).toEqual({ recibido: { nombre: 'Juan' } });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('devuelve undefined en un 204', async () => {
    simularApi({ 'POST /auth/salir': [204] });
    expect(await pedir('POST', '/auth/salir')).toBeUndefined();
  });

  it('traduce el formato de error común a ErrorDeApi', async () => {
    simularApi({
      'POST /usuarios': [409, { error: { codigo: 'USUARIO_EXISTENTE', mensaje: 'Ya existe.' } }],
    });

    const error = await pedir('POST', '/usuarios', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error).toMatchObject({
      status: 409,
      codigo: 'USUARIO_EXISTENTE',
      message: 'Ya existe.',
    });
  });

  it('ante un 401 de sesión avisa para volver al ingreso', async () => {
    const alNoAutenticado = vi.fn();
    configurarAlNoAutenticado(alNoAutenticado);
    simularApi({ 'GET /usuarios': SIN_SESION });

    await expect(pedir('GET', '/usuarios')).rejects.toMatchObject({ status: 401 });
    expect(alNoAutenticado).toHaveBeenCalledOnce();
  });

  it('un 401 de credenciales incorrectas no dispara el aviso', async () => {
    const alNoAutenticado = vi.fn();
    configurarAlNoAutenticado(alNoAutenticado);
    simularApi({
      'POST /auth/ingresar': [401, { error: { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'No.' } }],
    });

    await expect(pedir('POST', '/auth/ingresar', {})).rejects.toMatchObject({ status: 401 });
    expect(alNoAutenticado).not.toHaveBeenCalled();
  });

  it('sin conexión lanza un error legible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(pedir('GET', '/usuarios')).rejects.toMatchObject({ codigo: 'SIN_CONEXION' });
  });
});
