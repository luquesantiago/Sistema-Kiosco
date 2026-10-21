# Spec Delta

## Purpose

Garantiza que las ventas, el stock y las cajas sobrevivan a la pérdida del servidor, con una copia diaria de la base fuera de él y una forma probada de restaurarla.

## ADDED Requirements

### Requirement: Copia diaria de la base
El sistema SHALL generar todos los días a las 03:00 en hora de Argentina una copia completa y comprimida de la base, con la fecha en el nombre del archivo. Una copia que falla MUST dejar el error en el log y MUST NOT reemplazar ni borrar copias anteriores.

#### Scenario: Copia de la madrugada
- **WHEN** son las 03:00 en Argentina
- **THEN** se genera la copia del día con la fecha en el nombre

#### Scenario: Falla la copia
- **WHEN** la base no responde durante la copia
- **THEN** el error queda en el log y las copias anteriores siguen disponibles

### Requirement: Copia fuera del servidor
Cada copia SHALL subirse a una carpeta de Google Drive dedicada a los backups. Si la subida falla, la copia MUST quedar en el servidor y el siguiente intento MUST subir también las que faltaban.

#### Scenario: Subida a Google Drive
- **WHEN** se genera la copia del día
- **THEN** el archivo aparece en la carpeta de backups de Google Drive

#### Scenario: Google Drive no responde
- **WHEN** la subida falla un día
- **THEN** al día siguiente se suben las dos copias

### Requirement: Retención
El servidor SHALL conservar las copias de los últimos 7 días y Google Drive las de los últimos 30. Las copias más viejas MUST borrarse solo después de que la subida del día terminó bien.

#### Scenario: Copias viejas
- **WHEN** una copia en Google Drive tiene más de 30 días y la subida del día terminó bien
- **THEN** la copia vieja se borra

### Requirement: Restauración probada
SHALL existir un procedimiento documentado para restaurar cualquier copia (del servidor o de Google Drive) en una base vacía, que deje el sistema funcionando con los datos de esa fecha. El procedimiento MUST probarse al menos una vez antes del primer día real.

#### Scenario: Se perdió el servidor
- **WHEN** hay que montar el sistema en un servidor nuevo
- **THEN** siguiendo el procedimiento se restaura la última copia de Google Drive y el admin ve las ventas y el stock de ese día
