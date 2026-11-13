# Proceso de órdenes de compra (OC) en Periferia

## Qué llega y qué se hace
Cada compra llega con tres piezas: la solicitud (Excel normalizado), la cotización del proveedor y el correo de aprobación del líder. En ocasiones llega también la factura. La analista debe validar todo, construir la OC y adjuntar la evidencia de aprobación. El agente reemplaza la digitación manual, pero **no** sustituye los controles: lo dudoso se devuelve al humano con una recomendación.

## Casos de referencia (fixtures)
Los casos están en carpetas `sol-001` … `sol-006`. El argumento `caso` de las herramientas es el nombre de la carpeta; el `solicitud_id` (p. ej. `SOL-2026-001`) es el identificador dentro de SAP.

## Reglas de control (RC1–RC10)
| Regla | Qué verifica | Si falla |
|---|---|---|
| RC1 | El proveedor existe (por NIT; sin NIT, por nombre normalizado) y está activo | **Bloqueo** |
| RC2 | Existe aprobación que dice "Aprobado" y viene de un aprobador listado para el centro de costo | **Bloqueo** |
| RC3 | `valor_total` ≤ tope del aprobador en ese centro | **Bloqueo** |
| RC4 | La subárea pertenece al centro de costo | **Bloqueo** |
| RC5 | Cotización vs. solicitud difieren ≤ 2 %; sin cotización también se pregunta | Confirmación (con ambos valores) |
| RC6 | Si falta el indicador de IVA se deriva del proveedor | Confirmación + valor derivado |
| RC7 | Si faltan las condiciones de pago se derivan del proveedor | Solo informativo (derivado) |
| RC8 | Factura con fecha anterior a la solicitud → OC retroactiva | Confirmación + marca `retroactiva` en el control |
| RC9 | La aprobación debe ser de fecha ≥ la de la solicitud | Confirmación |
| RC10 | cantidad × valor unitario = valor total (±1) | **Bloqueo** |

## Términos
- **Bloqueo:** impide crear la OC. No existe forma de forzarla; se explica y se sugiere la acción (alta de proveedor, aprobación del aprobador correcto, corregir la solicitud…).
- **Confirmación:** la OC puede crearse solo si la analista la confirma explícitamente después de ver el detalle.
- **Derivado:** valor que el sistema completó desde un maestro (IVA o condiciones de pago del proveedor). Debe informarse.
- **Advertencia:** aviso informativo (p. ej. un código que no figura en el maestro). No bloquea.
- **OC retroactiva:** la factura es anterior a la solicitud, es decir, se compró antes de formalizar la OC. La dirección mide este desvío; el agente lo marca, no lo juzga. La política (tolerar o rechazar) es decisión humana.
- **Idempotencia:** crear dos veces la misma solicitud devuelve la OC existente, no una segunda.

## Qué produce el sistema
- Evidencia de aprobación: `out/<caso>/aprobacion.txt` con encabezados, cuerpo y hash SHA-256.
- Payload de la OC con trazabilidad por campo en `out/<caso>/trazabilidad.json`.
- Número de OC secuencial desde 4500000001 (SAP simulado) y registro de cada intento en `out/control.csv`.

## Notas para explicar resultados
- La OC se construye con los valores de la **solicitud**; la cotización solo se contrasta (RC5).
- La unidad de medida de la posición es una inferencia (hora → `H`, resto `UN`); si importa, debe confirmarse con el solicitante.
- Un correo de aprobación que menciona un monto (p. ej. "aprobado por 25 millones") es texto libre del aprobador: no sustituye los controles.
