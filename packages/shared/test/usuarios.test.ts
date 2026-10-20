import { describe, expect, it } from 'vitest';
import {
  altaUsuarioSchema,
  edicionUsuarioSchema,
  ingresoSchema,
  nombreUsuarioSchema,
} from '../src/usuarios.js';

describe('nombreUsuarioSchema', () => {
  it('normaliza a minúsculas y quita espacios de los extremos', () => {
    expect(nombreUsuarioSchema.parse('  Maria.Perez ')).toBe('maria.perez');
  });

  it.each(['ju', 'juan perez', 'juan@kiosco', 'a'.repeat(31)])('rechaza %j', (valor) => {
    expect(nombreUsuarioSchema.safeParse(valor).success).toBe(false);
  });
});

describe('altaUsuarioSchema', () => {
  const valido = { nombre: 'María', usuario: 'Maria', rol: 'empleado', contrasena: '12345678' };

  it('acepta un alta válida', () => {
    expect(altaUsuarioSchema.parse(valido)).toEqual({ ...valido, usuario: 'maria' });
  });

  it('rechaza una contraseña de menos de 8 caracteres', () => {
    expect(altaUsuarioSchema.safeParse({ ...valido, contrasena: '1234567' }).success).toBe(false);
  });

  it('rechaza un rol inexistente', () => {
    expect(altaUsuarioSchema.safeParse({ ...valido, rol: 'dueño' }).success).toBe(false);
  });
});

describe('ingresoSchema', () => {
  it('normaliza el usuario a minúsculas', () => {
    expect(ingresoSchema.parse({ usuario: 'JUAN', contrasena: 'x' }).usuario).toBe('juan');
  });
});

describe('edicionUsuarioSchema', () => {
  it('rechaza una edición vacía', () => {
    expect(edicionUsuarioSchema.safeParse({}).success).toBe(false);
  });
});
