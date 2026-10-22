import { Navigate, type RouteObject } from 'react-router';
import { Avisos } from '../admin/Avisos.js';
import { PanelAdmin } from '../admin/PanelAdmin.js';
import { AumentoPrecios } from '../admin/productos/AumentoPrecios.js';
import { FichaProducto } from '../admin/productos/FichaProducto.js';
import { ListaProductos } from '../admin/productos/ListaProductos.js';
import { NuevoProducto } from '../admin/productos/NuevoProducto.js';
import { Proveedores } from '../admin/Proveedores.js';
import { DetalleTurno, Turnos } from '../admin/Turnos.js';
import { Usuarios } from '../admin/Usuarios.js';
import { Whatsapp } from '../admin/Whatsapp.js';
import { IngresoMercaderia } from '../stock/IngresoMercaderia.js';
import { DetalleIngreso, Ingresos } from '../stock/Ingresos.js';
import { StockAdmin } from '../stock/StockAdmin.js';
import { VentasSinSistema } from '../stock/VentasSinSistema.js';
import { Venta } from '../pos/Venta.js';
import { DetalleVenta, Ventas } from '../ventas/Ventas.js';
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
      { path: 'ventas', element: <Ventas /> },
      { path: 'ventas/:id', element: <DetalleVenta /> },
      { path: 'stock/ingreso', element: <IngresoMercaderia /> },
      { path: 'cuenta/contrasena', element: <CambiarContrasena /> },
      {
        path: 'admin',
        element: <RequiereRol rol="admin" />,
        children: [
          { index: true, element: <PanelAdmin /> },
          { path: 'productos', element: <ListaProductos /> },
          { path: 'productos/nuevo', element: <NuevoProducto /> },
          { path: 'productos/aumento', element: <AumentoPrecios /> },
          { path: 'productos/:id', element: <FichaProducto /> },
          { path: 'stock', element: <StockAdmin /> },
          { path: 'stock/ventas-sin-sistema', element: <VentasSinSistema /> },
          { path: 'stock/ingresos', element: <Ingresos /> },
          { path: 'stock/ingresos/:id', element: <DetalleIngreso /> },
          { path: 'proveedores', element: <Proveedores /> },
          { path: 'usuarios', element: <Usuarios /> },
          { path: 'avisos', element: <Avisos /> },
          { path: 'whatsapp', element: <Whatsapp /> },
          { path: 'turnos', element: <Turnos /> },
          { path: 'turnos/:id', element: <DetalleTurno /> },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
