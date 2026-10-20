import { Navigate, type RouteObject } from 'react-router';
import { PanelAdmin } from '../admin/PanelAdmin.js';
import { Usuarios } from '../admin/Usuarios.js';
import { Venta } from '../pos/Venta.js';
import { CambiarContrasena } from './CambiarContrasena.js';
import { Ingresar } from './Ingresar.js';
import { Layout, RedireccionInicio, RequiereRol } from './Layout.js';

export const rutas: RouteObject[] = [
  { path: '/ingresar', element: <Ingresar /> },
  {
    // Todo lo demás exige sesión (Layout redirige a /ingresar si no hay).
    element: <Layout />,
    children: [
      { index: true, element: <RedireccionInicio /> },
      { path: 'venta', element: <Venta /> },
      { path: 'cuenta/contrasena', element: <CambiarContrasena /> },
      {
        path: 'admin',
        element: <RequiereRol rol="admin" />,
        children: [
          { index: true, element: <PanelAdmin /> },
          { path: 'usuarios', element: <Usuarios /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
