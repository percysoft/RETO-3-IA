# Supuestos del core determinístico (B1)

Fuente: PRD.md y fixtures. El documento de Discovery de B0 no estaba en el workspace; los supuestos
siguientes se infirieron de PRD y fixtures y deben contrastarse con él.

## Datos
1. **NIT**: se comparan solo los dígitos antes del guion ("900.555.111-2" → `900555111`). El DV se descarta.
2. **Sin NIT (sol-006)**: RC1 busca por nombre normalizado (sin tildes, puntuación ni mayúsculas). El NIT de la cotización NO se usa para identificar al proveedor.
3. **Fechas**: se comparan por día calendario tal como están escritas (sin convertir zona horaria). RC9: aprobación el mismo día de la solicitud es válida (sol-004, 18:45-05:00).
4. **Montos**: formato colombiano (`COP 11.400.000`); un texto no numérico produce `{ok:false}` al leer el paquete.
5. **"Aprobado"**: coincidencia de palabra completa, sin tildes/mayúsculas; se descartan negaciones ("no aprobado", "sin aprobar", "rechazado").
6. **sol-004**: el correo dice "Aprobado por 25 millones"; no hay regla que lo contraste, el monto del payload sale de la solicitud (25M), nunca de la cotización (26,5M).

## Reglas
7. **RC3** solo se evalúa si RC2 identificó al aprobador en el centro; si no, RC2 ya bloquea (sol-003 reporta solo RC2).
8. **RC6/RC7**: un código informado que no existe en el maestro genera solo una **advertencia no bloqueante** (`advertencias[]` en `oc_validar`); no impide ni condiciona la creación. El PRD no lo define como regla de control (ajuste B2→B3).
9. **RC5**: moneda distinta entre cotización y solicitud → confirmación (no comparables).
10. `valor_total` ≤ 0 en RC5 se trata como diferencia indeterminada → confirmación.

## Payload
11. **Orden**: evidencia → payload → trazabilidad. La evidencia depende solo de la aprobación; el payload necesita su SHA-256.
12. **Hash**: se calcula sobre encabezados + cuerpo; el archivo `aprobacion.txt` añade al final `sha256: <hex>`.
13. **Unidad**: no existe en los fixtures. Se infiere: "hora(s)" → `H`; "mensual/por mes" → `MES`; resto `UN`. Se traza como `derivado`.
    **Limitación**: es una heurística por palabras clave, no un dato. Falla si "horas" aparece en otro contexto, no reconoce otras formas de "mensual" y asigna `UN` a servicios por día o proyecto. En producción la unidad debe venir explícita en la solicitud; esta inferencia debería retirarse o pasar a confirmación.
14. **Descripción**: se trunca a 40 caracteres (límite SAP); si se trunca, la traza lo indica.
15. Una sola posición (`numero: 10`); `sociedad` y `organizacion_compras` = `"1000"` (traza `constante`).
16. Fuentes de trazabilidad adicionales a las del PRD: `correo`, `aprobacion`, `evidencia`, `constante`.

## Confirmación (responsabilidad del backend)
17. `confirmado` del modelo es solo una intención. `oc_crear` procede únicamente si: (a) el backend ya presentó esas mismas confirmaciones (huella en `out/confirmaciones.json`, la registra `oc_validar` o un intento previo de `oc_crear`), y (b) `ctx.confirmacionHumana` está fijado por el backend. Ninguna herramienta expone (b) al modelo.
18. `oc_construir_payload` y `oc_crear` ignoran `paquete`/`derivados`/`payload` enviados por el modelo: releen y revalidan desde disco. Un `payload` recibido que difiera del validado se rechaza.
19. Idempotencia por `solicitud_id` se resuelve antes que bloqueos/confirmaciones (una OC ya creada se devuelve tal cual).

## Control (`out/control.csv`)
20. Resultados: `CREADA`, `IDEMPOTENTE`, `BLOQUEADA`, `PENDIENTE_CONFIRMACION`, `ERROR`. `bloqueos`/`confirmaciones` son códigos RC separados por `;`. Si el paquete no se puede leer, `solicitud_id` = nombre del caso.
