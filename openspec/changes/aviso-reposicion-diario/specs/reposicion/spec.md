# Spec Delta

## Purpose

Le dice al admin, una vez por día y por WhatsApp, qué productos hay que reponer y cuánto pedir de cada uno, agrupados por proveedor y empezando por los que toman pedido ese día.

## ADDED Requirements

### Requirement: Productos a reponer
Un producto activo SHALL entrar en la reposición cuando su stock actual es menor o igual a su stock mínimo. La cantidad sugerida MUST ser el stock máximo menos el stock actual. Un producto desactivado MUST NOT entrar, cualquiera sea su stock. El cálculo MUST usar el stock del momento en que se hace.

#### Scenario: Stock justo arriba del mínimo
- **WHEN** un producto activo tiene mínimo 5, máximo 20 y stock actual 6
- **THEN** no entra en la reposición

#### Scenario: Stock igual al mínimo
- **WHEN** un producto activo tiene mínimo 5, máximo 20 y stock actual 5
- **THEN** entra con cantidad sugerida 15

#### Scenario: Stock justo debajo del mínimo
- **WHEN** un producto activo tiene mínimo 5, máximo 20 y stock actual 4
- **THEN** entra con cantidad sugerida 16

#### Scenario: Stock negativo
- **WHEN** un producto activo tiene mínimo 5, máximo 20 y stock actual -3
- **THEN** entra con cantidad sugerida 23

#### Scenario: Producto desactivado
- **WHEN** un producto desactivado tiene mínimo 5, máximo 20 y stock actual 0
- **THEN** no entra en la reposición

### Requirement: Mínimo y máximo en cero
Un producto con stock mínimo 0 y stock máximo 0 MUST NOT entrar nunca en la reposición, cualquiera sea su stock: significa "no reponer". Un producto con mínimo 0 y máximo mayor que 0 MUST entrar cuando su stock actual es 0 o menos.

#### Scenario: No reponer nunca con stock cero
- **WHEN** un producto activo tiene mínimo 0, máximo 0 y stock actual 0
- **THEN** no entra en la reposición

#### Scenario: No reponer nunca con stock negativo
- **WHEN** un producto activo tiene mínimo 0, máximo 0 y stock actual -2
- **THEN** no entra en la reposición

#### Scenario: Mínimo cero con stock uno
- **WHEN** un producto activo tiene mínimo 0, máximo 10 y stock actual 1
- **THEN** no entra en la reposición

#### Scenario: Mínimo cero con stock cero
- **WHEN** un producto activo tiene mínimo 0, máximo 10 y stock actual 0
- **THEN** entra con cantidad sugerida 10

#### Scenario: Mínimo cero con stock negativo
- **WHEN** un producto activo tiene mínimo 0, máximo 10 y stock actual -1
- **THEN** entra con cantidad sugerida 11

### Requirement: Renglones sin cantidad para pedir
Un producto cuya cantidad sugerida es 0 o menos MUST NOT aparecer en la reposición, aunque su stock actual sea menor o igual al mínimo. Esto solo pasa cuando el mínimo es igual al máximo y el stock está en ese valor.

#### Scenario: Mínimo igual al máximo con stock en el borde
- **WHEN** un producto activo tiene mínimo 5, máximo 5 y stock actual 5
- **THEN** no aparece en la reposición, porque la cantidad sugerida es 0

#### Scenario: Mínimo igual al máximo con stock uno debajo
- **WHEN** un producto activo tiene mínimo 5, máximo 5 y stock actual 4
- **THEN** entra con cantidad sugerida 1

#### Scenario: Mínimo igual al máximo con stock uno arriba
- **WHEN** un producto activo tiene mínimo 5, máximo 5 y stock actual 6
- **THEN** no entra en la reposición

### Requirement: Agrupación por proveedor
Los productos a reponer MUST agruparse por su proveedor. Un producto sin proveedor, o cuyo proveedor está desactivado, MUST ir a un grupo "Sin proveedor". Un proveedor sin productos a reponer MUST NOT aparecer.

#### Scenario: Productos de dos proveedores
- **WHEN** faltan 2 productos de Coca-Cola y 1 de Arcor
- **THEN** la reposición tiene un grupo Coca-Cola con 2 productos y un grupo Arcor con 1

#### Scenario: Producto sin proveedor
- **WHEN** falta el hielo, que no tiene proveedor
- **THEN** el hielo aparece en el grupo "Sin proveedor"

#### Scenario: Proveedor desactivado
- **WHEN** falta un producto cuyo proveedor está desactivado
- **THEN** el producto aparece en el grupo "Sin proveedor" y no en un grupo con el nombre de ese proveedor

#### Scenario: Proveedor sin faltantes
- **WHEN** Pepsi toma pedido hoy pero ninguno de sus productos está en o debajo del mínimo
- **THEN** Pepsi no aparece en la reposición

### Requirement: Orden de la reposición
Primero MUST ir los proveedores que toman pedido el día de hoy en Argentina, ordenados por nombre; después el resto de los proveedores, por nombre; al final, el grupo "Sin proveedor". Dentro de cada grupo, los productos MUST ordenarse por nombre. Los nombres MUST ordenarse sin distinguir mayúsculas ni acentos.

#### Scenario: Proveedor que toma pedido hoy va primero
- **WHEN** el martes faltan productos de Arcor, que toma pedido los jueves, y de Coca-Cola, que toma pedido los martes
- **THEN** Coca-Cola va antes que Arcor

#### Scenario: Resto por nombre
- **WHEN** el martes faltan productos de Pepsi y de Arcor y ninguno toma pedido los martes
- **THEN** Arcor va antes que Pepsi

#### Scenario: Sin proveedor al final
- **WHEN** faltan productos sin proveedor, de Arcor y de Coca-Cola
- **THEN** el grupo "Sin proveedor" va último

#### Scenario: Productos por nombre sin distinguir acentos
- **WHEN** faltan "Ñandú galletitas", "alfajor" y "Óreo" del mismo proveedor
- **THEN** se ordenan "alfajor", "Ñandú galletitas", "Óreo"

#### Scenario: Proveedor sin días de pedido
- **WHEN** faltan productos de un proveedor activo que no tiene ningún día de pedido cargado
- **THEN** nunca cuenta como "toma pedido hoy" y va con el resto, por nombre

### Requirement: Día de hoy en Argentina
"Hoy" MUST ser el día de la semana en Argentina (UTC−3) en el momento del cálculo. El día cambia a las 00:00 de Argentina, que son las 03:00 UTC.

#### Scenario: Último segundo del martes
- **WHEN** se calcula la reposición a las 2026-11-11T02:59:59Z (martes 10/11 23:59:59 en Argentina) y Coca-Cola toma pedido los martes
- **THEN** Coca-Cola cuenta como "toma pedido hoy"

#### Scenario: Primer segundo del miércoles
- **WHEN** se calcula la reposición a las 2026-11-11T03:00:00Z (miércoles 11/11 00:00:00 en Argentina) y Coca-Cola toma pedido los martes
- **THEN** Coca-Cola no cuenta como "toma pedido hoy"

### Requirement: Pedido por llegar
Si un proveedor tiene un pedido "por llegar", sus productos a reponer MUST mostrarse igual, con la marca "Ya hay un pedido por llegar el <día>". Si tiene varios, la marca MUST usar la fecha de llegada más cercana. Los pedidos que ya llegaron, están cargados o cancelados MUST NOT generar la marca.

#### Scenario: Coca con pedido en camino
- **WHEN** faltan productos de Coca-Cola y hay un pedido a Coca-Cola por llegar el jueves 12/11
- **THEN** los productos de Coca-Cola aparecen igual
- **AND** el grupo tiene la marca "Ya hay un pedido por llegar el jueves 12/11"

#### Scenario: Dos pedidos por llegar
- **WHEN** Coca-Cola tiene un pedido por llegar el viernes 13/11 y otro el jueves 12/11
- **THEN** la marca dice el jueves 12/11

#### Scenario: Pedido atrasado
- **WHEN** Coca-Cola tiene un pedido por llegar con fecha lunes 09/11 y hoy es martes 10/11
- **THEN** la marca dice el lunes 09/11

#### Scenario: Pedido que ya llegó o se canceló
- **WHEN** el único pedido de Coca-Cola ya llegó, o está cancelado
- **THEN** el grupo de Coca-Cola no tiene la marca

### Requirement: Texto del aviso de reposición
El aviso MUST ser un único mensaje legible por WhatsApp con la fecha, "Stock a las HH:MM" (hora de Argentina en que se calculó) y los grupos en orden. De los proveedores que toman pedido hoy y del grupo "Sin proveedor" MUST listar cada producto con su cantidad sugerida; del resto, solo el nombre del proveedor y cuántos productos le faltan. La marca de pedido por llegar MUST aparecer en ambos casos.

#### Scenario: Día con faltantes
- **WHEN** el martes 10/11 a las 12:00 faltan 24 Coca 500 ml y 12 Sprite 500 ml de Coca-Cola (toma pedido los martes), 5 productos de Arcor (toma pedido los jueves) y 10 bolsas de hielo sin proveedor
- **THEN** el aviso dice el martes 10/11 y "Stock a las 12:00"
- **AND** lista Coca 500 ml: 24 y Sprite 500 ml: 12 bajo Coca-Cola
- **AND** dice Arcor con 5 productos, sin listarlos
- **AND** lista Hielo: 10 bajo "Sin proveedor", al final

#### Scenario: Un solo producto en un proveedor de otro día
- **WHEN** a Pepsi, que no toma pedido hoy, le falta un solo producto
- **THEN** el aviso dice Pepsi con "1 producto", en singular

#### Scenario: Marca en un proveedor de otro día
- **WHEN** a Arcor, que no toma pedido hoy, le faltan 5 productos y tiene un pedido por llegar el jueves 12/11
- **THEN** la línea de Arcor dice los 5 productos y que hay un pedido por llegar el jueves 12/11

#### Scenario: Día sin faltantes
- **WHEN** a la hora del aviso no hay ningún producto para reponer
- **THEN** igual se genera el aviso, con la fecha, la hora del stock y "Hoy no hay nada para reponer"

### Requirement: Hora del aviso diario
El sistema SHALL generar el aviso de reposición todos los días a partir de las 12:00:00 de Argentina (15:00:00 UTC), sin intervención de nadie, con un retraso máximo de un minuto. Antes de las 12:00:00 de Argentina MUST NOT generarse el aviso de ese día.

#### Scenario: Un segundo antes de las 12
- **WHEN** el sistema revisa a las 2026-11-10T14:59:59Z (11:59:59 en Argentina) y todavía no hay aviso del 10/11
- **THEN** no genera ningún aviso

#### Scenario: A las 12 en punto
- **WHEN** el sistema revisa a las 2026-11-10T15:00:00Z (12:00:00 en Argentina) y todavía no hay aviso del 10/11
- **THEN** genera el aviso de reposición del 10/11 con "Stock a las 12:00"

#### Scenario: Un segundo después de las 12
- **WHEN** el sistema revisa a las 2026-11-10T15:00:01Z (12:00:01 en Argentina) y todavía no hay aviso del 10/11
- **THEN** genera el aviso de reposición del 10/11

### Requirement: Recuperación si el sistema estuvo apagado
Si a las 12:00 el sistema estaba apagado, MUST generar el aviso de ese día al volver, siempre que sean las 18:59:59 de Argentina o antes. A partir de las 19:00:00 de Argentina (22:00:00 UTC) MUST NOT generar el aviso de ese día. El aviso de un día que ya pasó MUST NOT generarse nunca.

#### Scenario: Vuelve a las 15:20
- **WHEN** el sistema estuvo apagado de 11:00 a 15:20 de Argentina del 10/11 y vuelve sin aviso de ese día
- **THEN** genera el aviso del 10/11 con "Stock a las 15:20"

#### Scenario: Vuelve un segundo antes de las 19
- **WHEN** el sistema revisa a las 2026-11-10T21:59:59Z (18:59:59 en Argentina) sin aviso del 10/11
- **THEN** genera el aviso del 10/11

#### Scenario: Vuelve a las 19 en punto
- **WHEN** el sistema revisa a las 2026-11-10T22:00:00Z (19:00:00 en Argentina) sin aviso del 10/11
- **THEN** no genera ningún aviso

#### Scenario: Vuelve al día siguiente a la mañana
- **WHEN** el sistema estuvo apagado todo el 10/11 y vuelve a las 2026-11-11T12:00:00Z (09:00 del 11/11 en Argentina)
- **THEN** no genera el aviso del 10/11 ni el del 11/11
- **AND** a las 2026-11-11T15:00:00Z (12:00 del 11/11) genera el aviso del 11/11

### Requirement: Un solo aviso por día
El sistema MUST generar como máximo un aviso de reposición por día de Argentina, aunque revise varias veces ese día o dos revisiones coincidan. El día de Argentina empieza a las 00:00 (03:00 UTC). La garantía MUST valer aunque la app se reinicie.

#### Scenario: Segunda revisión el mismo día
- **WHEN** ya se generó el aviso del 10/11 a las 12:00 y el sistema vuelve a revisar a las 2026-11-10T15:01:00Z y a las 2026-11-10T21:59:59Z
- **THEN** no genera otro aviso

#### Scenario: Reinicio después de generar
- **WHEN** se generó el aviso del 10/11 a las 12:00 y la app se reinicia a las 13:00 del 10/11
- **THEN** al volver no genera otro aviso del 10/11

#### Scenario: Dos revisiones a la vez
- **WHEN** dos revisiones corren al mismo tiempo a las 12:00 del 10/11 sin aviso previo de ese día
- **THEN** queda un solo aviso de reposición del 10/11 y ninguna de las dos falla

#### Scenario: Cambio de día
- **WHEN** se generó el aviso del 10/11 y el sistema revisa a las 2026-11-11T02:59:59Z (23:59:59 del 10/11) y a las 2026-11-11T03:00:00Z (00:00:00 del 11/11)
- **THEN** no genera ningún aviso en ninguna de las dos revisiones
- **AND** a las 2026-11-11T15:00:00Z genera el aviso del 11/11

### Requirement: Aviso sin WhatsApp configurado
El aviso de reposición MUST generarse a su hora aunque WhatsApp no esté configurado, no esté conectado o falte el número de destino. En ese caso MUST quedar pendiente y visible en Avisos, como los demás avisos.

#### Scenario: Sistema sin WAHA
- **WHEN** el sistema funciona sin WhatsApp configurado y llegan las 12:00 del 10/11
- **THEN** se genera el aviso de reposición del 10/11 y queda pendiente en Avisos

#### Scenario: Sin número de destino
- **WHEN** WhatsApp está conectado pero no hay número de destino a las 12:00
- **THEN** se genera el aviso y queda pendiente hasta que se cargue el número
