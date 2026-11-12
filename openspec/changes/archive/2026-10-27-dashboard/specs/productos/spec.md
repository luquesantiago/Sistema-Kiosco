# Spec Delta

## ADDED Requirements

### Requirement: Filtro de productos sin costo
El admin SHALL poder filtrar la lista de productos para ver solo los activos que no tienen costo cargado, combinable con la búsqueda por nombre. El dashboard MUST enlazar a esa lista filtrada desde lo vendido sin costo. Para el empleado, el filtro MUST ignorarse.

#### Scenario: Completar costos desde el dashboard
- **WHEN** el admin toca "vendido sin costo" en el dashboard
- **THEN** ve la lista de productos activos sin costo y puede abrir cada uno para cargarlo

#### Scenario: El filtro con un empleado
- **WHEN** un empleado busca productos indicando el filtro sin costo
- **THEN** el filtro se ignora y recibe la búsqueda normal, sin costos
