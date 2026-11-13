# Agente conversacional de Órdenes de Compra (SAP simulado)

Reto técnico 03 · Perxia 2.0. Un agente que lee el paquete de una compra (correo, solicitud, cotización, aprobación y, si existe, la factura), lo valida contra los maestros, construye el payload de la orden de compra (OC), genera la evidencia de aprobación y crea la OC en un SAP simulado. Las excepciones no se resuelven a la fuerza: se **bloquean** o se **piden a un humano para confirmar**.

> Principio de diseño: **el modelo de lenguaje conversa; el backend decide.** Las reglas de control, el payload, la numeración y la autorización de crear una OC viven en código determinístico (`src/core`), independiente de cualquier LLM. El modelo solo opera herramientas tipadas y explica sus resultados.

Más detalle para evaluación en [SOLUCION.md](SOLUCION.md). Supuestos de interpretación del PRD en [docs/supuestos-b1.md](docs/supuestos-b1.md).

## Estado

**Implementado y verificado**

| Pieza | Estado |
|---|---|
| Core RC1–RC10, payload, evidencia TXT + SHA-256, idempotencia, `control.csv` | Hecho; 200 pruebas automáticas en total (el proyecto completo) |
| SAP simulado (`out/sap/ordenes.jsonl`, numeración desde 4500000001) | Hecho |
| Herramientas `oc_*` con Zod | Hecho |
| Agente con Anthropic (ciclo, límites, sesiones, log) | Hecho; **ejecutado con Anthropic real en los seis casos de aceptación** (ver más abajo) |
| Servidor HTTP + front web | Hecho; usado con el modelo real desde Chrome en sol-002 a sol-006 (botones de proceso y de confirmación) |
| Auditoría de confirmaciones (eventos en `log.jsonl`, estados en `control.csv`) | Hecho (B6.1) |
| `demo.ts` sin LLM | Hecho |
| Seguridad para link público: `ACCESS_KEY` obligatoria en producción, pantalla de acceso, `TRUST_PROXY` (desactivado), `GLOBAL_TOKEN_BUDGET` | Hecho y probado en local (200 pruebas) |
| `Dockerfile`, `.dockerignore`, `render.yaml` | Escritos y validados con pruebas estáticas; **imagen no construida** |

**Preparado pero no desplegado:** despliegue en Render Free (Dockerfile, `render.yaml`, clave de acceso, presupuesto global de tokens y configuración de proxy). Verificado en local; **la imagen Docker no se construyó** (no hay Docker local) y no hay link público todavía. Ver [Despliegue en Render Free](#despliegue-en-render-free).

**Pendiente** (no implementado): link público, PDF de evidencia (P1), `oc_leer_excel` (P1), módulo reutilizable (bonus), streaming, SAP real, identidad por usuario. Las mejoras derivadas de las pruebas reales están en [Limitaciones conocidas](#limitaciones-conocidas).

## Pruebas reales con Anthropic

Los seis casos se ejecutaron el 2026-11-13 con `claude-opus-5-5` contra el servidor real. sol-001 la ejecutó el autor con un mensaje escrito por él; sol-002 a sol-006 se procesaron desde el front real (Chrome) con el botón «Procesar sol-00X», y las confirmaciones de sol-004, sol-005 y sol-006 se dieron con el botón «Confirmo» de la interfaz. Se crearon **cuatro órdenes** en el SAP simulado (4500000001 a 4500000004).

| Caso | Resultado real | Confirmación | OC |
|---|---|---|---|
| sol-001 | Apta, sin excepciones: se creó sola | no requerida | **4500000001** |
| sol-002 | **Bloqueada por RC1** (NIT 901999000 no existe en el maestro); el agente explicó el bloqueo y la acción sugerida | — | ninguna |
| sol-003 | **Bloqueada por RC2** (`fvargas` no es aprobador de CC-2020; el válido es `rtorres`) | — | ninguna |
| sol-004 | **RC5**: cotización 26.500.000 vs solicitud 25.000.000 (6,00 %); creada tras confirmación | humana (botón «Confirmo») | **4500000002** |
| sol-005 | **RC8**: OC retroactiva (factura 2026-08-10 anterior a la solicitud 2026-08-27); creada tras confirmación, `retroactiva=true` | humana (botón «Confirmo») | **4500000003** |
| sol-006 | **RC6**: IVA `C1` y pago `Z030` derivados del proveedor; creada tras confirmación | humana (botón «Confirmo») | **4500000004** |

En sol-004, sol-005 y sol-006 se repitió la creación desde una sesión nueva y el backend devolvió la misma OC (`idempotente=true`); en ningún caso se creó una segunda orden.

Consumo **medido** (tokens de entrada + salida + caché que reporta el proveedor, por sesión): 193.437 tokens en total (desglose por caso en [SOLUCION.md §5](SOLUCION.md)). El costo en dólares es solo una estimación, porque no se guardó el desglose entre entrada y salida.

> **Desviación en sol-005:** esa ejecución se hizo en una sesión **reutilizada** (`47b9741e…`, que ya traía 9.307 tokens y dos llamadas de la prueba de idempotencia de sol-004) por un error en la preparación del navegador. El resultado funcional fue válido, pero **no cumplió el requisito de «sesión nueva»**. Detalle en [SOLUCION.md §5.4](SOLUCION.md).

## Arquitectura

```
Navegador (web/)  ──HTTP──▶  src/server.ts  ──▶  src/agente/ (ciclo del agente)
  chat, tool calls,            validación,            │  prompt: agent/prompt.md
  panel de confirmación        CORS, límites          │  conocimiento: src/knowledge/
                                                      ▼
                                          src/llm/ (adaptador neutral + Anthropic)
                                                      │ tool use
                                                      ▼
                              src/tools/oc.ts  (herramientas tipadas, Zod)
                                                      ▼
                       src/core/  (reglas RC1–RC10, validación, evidencia, payload,
                                   confirmaciones, auditoría, control, servicio de creación)
                                                      ▼
                       src/sap/   (interfaz SapAdapter + mock sobre archivos)
                                                      ▼
            fixtures/ (solo lectura)                out/ (escritura)
```

```
.
├── agent/prompt.md              # system prompt (comportamiento)
├── src/
│   ├── knowledge/ordenes-compra.md   # conocimiento del proceso
│   ├── core/                    # lógica de negocio determinística (sin LLM)
│   │   └── reglas/              # una función pura por regla RC1…RC10
│   ├── sap/                     # SapAdapter + MockSapAdapter
│   ├── tools/oc.ts              # herramientas oc_leer_paquete, oc_validar, …
│   ├── llm/                     # LlmAdapter (neutral) + AnthropicAdapter
│   ├── agente/                  # ciclo, sesiones, confirmación, log, registro de herramientas
│   ├── config.ts                # lectura/validación de límites (Zod)
│   └── server.ts                # API HTTP y archivos estáticos
├── web/                         # front: HTML + CSS + JS, sin build
├── tests/                       # bun test (proveedor LLM simulado, sin red)
├── demo.ts                      # recorre los 6 casos sin LLM
├── fixtures/reto-03/            # entregados por Periferia (no modificar)
├── out/                         # salida generada (ignorada por git)
└── docs/supuestos-b1.md
```

## Requisitos e instalación

- [Bun](https://bun.sh) (desarrollado y probado con 1.4.4). No se usa Node ni paso de build.
- Dependencias de ejecución: `zod` y `@anthropic-ai/sdk`. De desarrollo: `typescript`, `@types/bun`.

```bash
bun install
```

## Variables de entorno

Copie `.env.example` a `.env` (Bun lo carga solo; `.env` está en `.gitignore`).

| Variable | Defecto | Descripción |
|---|---|---|
| `LLM_API_KEY` | — | Clave de Anthropic. Solo se lee en el backend. `ANTHROPIC_API_KEY` también se acepta. Sin ella el servidor arranca y reporta "IA sin configurar". |
| `LLM_MODEL` | `claude-opus-5-5` | Modelo de Anthropic. |
| `LLM_PROVIDER` | `anthropic` | Informativo (se muestra en `/api/health` si la IA no está configurada). Hoy el único adaptador es Anthropic. |
| `PORT` | `3000` | Puerto HTTP. |
| `HOST` | `127.0.0.1` | Interfaz de escucha (no puede estar vacío). El `Dockerfile` fija `0.0.0.0`. |
| `CORS_ORIGINS` | vacío | Orígenes externos permitidos (coma). Vacío = solo mismo origen. |
| `RATE_LIMIT_CHAT_PER_MIN` | `30` | Mensajes de chat por IP y minuto. Entero positivo; ausente → 30; vacío, 0, negativo, decimal o texto → el servidor no arranca (error de configuración). |
| `MAX_ITERACIONES` | `25` | Tope de iteraciones herramienta→modelo por turno. |
| `MAX_TOKENS_SESION` | `100000` | Tope de tokens (entrada + salida) por sesión. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout por llamada al proveedor. |
| `NODE_ENV` | vacío | Con `production`, `ACCESS_KEY` es obligatoria y el servidor no arranca sin ella. |
| `ACCESS_KEY` | — | Clave de acceso compartida (≥ 16 caracteres) para `/api/chat`, `/api/sessions/:id` y `/api/diagnostico`, enviada en la cabecera `X-Access-Key`. Sin ella (y fuera de producción) el acceso es abierto. `/api/health` y los estáticos son siempre públicos. |
| `TRUST_PROXY` | `false` | `true`/`false`. Si es `true`, la IP del cliente se toma de `TRUST_PROXY_HEADER`; por defecto no se confía en ninguna cabecera. |
| `TRUST_PROXY_HEADER` | `x-forwarded-for` | Cabecera con la cadena de IPs (solo con `TRUST_PROXY=true`). |
| `TRUST_PROXY_HOPS` | `1` | Proxies de confianza, contados desde la derecha de la cadena. |
| `GLOBAL_TOKEN_BUDGET` | sin tope | Entero positivo: tope de tokens de todo el proceso (en memoria, se reinicia con el proceso). Definido pero vacío se rechaza. |
| `EPHEMERAL_STORAGE` | `false` | `true` avisa en `/api/health` y en la UI que los datos se pierden al reiniciar (Render Free). |

## Cómo ejecutar

```bash
bun run demo         # 6 casos + idempotencia, SIN LLM ni clave
bun run dev          # servidor + front en http://127.0.0.1:3000  (igual que `bun run start`)
bun test             # 200 pruebas, sin red ni clave
bun run typecheck    # tsc --noEmit
```

> **Atención:** `bun run demo` **borra el contenido de `out/`** al iniciar (para ser determinístico). No lo ejecute sobre datos de una prueba real que quiera conservar; haga antes una copia de `out/`.

### Demo sin API key

`bun run demo` limpia `out/`, procesa `sol-001`…`sol-006` llamando directamente a las herramientas, simula la confirmación humana donde corresponde (004, 005 y 006) y repite `sol-001` para mostrar la idempotencia. No importa el adaptador de LLM, no usa red y funciona sin variables de entorno. Resultado (verificado, **sin LLM**):

| Caso | Resultado de la demo |
|---|---|
| sol-001 | OC `4500000001` creada sin intervención |
| sol-002 | Bloqueada (RC1), sin OC |
| sol-003 | Bloqueada (RC2), sin OC |
| sol-004 | Confirmación (RC5) → tras «confirmo», OC `4500000002` |
| sol-005 | Retroactiva, confirmación (RC8) → OC `4500000003` con `retroactiva=true` en control |
| sol-006 | IVA y pago derivados, confirmación (RC6) → OC `4500000004` |
| sol-001 (2.ª vez) | Devuelve `4500000001` como idempotente |

Genera `out/control.csv`, `out/log.jsonl`, `out/sap/ordenes.jsonl`, `out/<caso>/aprobacion.txt` y `out/<caso>/trazabilidad.json`. Su salida coincide con las órdenes de las pruebas reales; la diferencia está en `control.csv` y `log.jsonl` (ver [Auditoría](#auditoría-estados-de-control-y-eventos)).

### Configurar Anthropic

1. Cree una clave en la consola de Anthropic (se recomienda una clave exclusiva para este proyecto y con límite de gasto).
2. Escríbala en `.env` como `LLM_API_KEY=...` (nunca en el código ni en el front; `.env` queda con permisos `600` y fuera de Git). Opcional: `LLM_MODEL=...`.
3. `bun run dev` y abra `http://127.0.0.1:3000`. `GET /api/health` debe mostrar `llm.configurado: true` (solo indica que hay clave; no verifica que el proveedor responda).
4. En el chat, use los botones «Procesar sol-00X» o escriba, por ejemplo: *«Procesa la solicitud sol-004. Muéstrame la OC como quedaría en SAP y no la crees hasta que yo lo confirme.»*

**Configuración real del adaptador** (`src/llm/anthropic.ts`, SDK oficial `@anthropic-ai/sdk`):

- Modelo `claude-opus-5-5` por defecto, configurable con `LLM_MODEL`.
- `tool_choice: auto` (el modelo decide cuándo usar herramientas; nunca se fuerza una) y sin parámetros de muestreo.
- Prompt de sistema (`agent/prompt.md` + `src/knowledge/ordenes-compra.md`) marcado como cacheable.
- Hasta 8.000 tokens por respuesta, timeout de 60 s por llamada (`LLM_TIMEOUT_MS`) y 1 reintento del SDK.
- Los bloques de razonamiento que devuelve el modelo se reenvían sin alterar en el historial de la conversación.
- La clave se lee solo del entorno del backend y se redacta de logs, sesiones, errores y respuestas.

## Auditoría: estados de control y eventos

**`out/control.csv`** registra los intentos con las columnas `solicitud_id, resultado, numero_oc, retroactiva, bloqueos, confirmaciones, ts`. Estados de `resultado`:

| Estado | Cuándo |
|---|---|
| `PENDIENTE_CONFIRMACION` | El backend da por presentada la solicitud de confirmación (el agente cerró el turno con la pregunta) o hay un intento de `oc_crear` sin confirmación. Una sola vez por solicitud y huella. |
| `CREADA` | La OC se creó (con o sin confirmación previa). |
| `RECHAZADA` | El usuario rechazó explícitamente la confirmación; no se crea OC. |
| `IDEMPOTENTE` | Se intentó crear de nuevo y se devolvió la OC existente. |
| `BLOQUEADA` | Hubo un intento de `oc_crear` sobre un caso con bloqueos (ver limitación: no se registra si nadie llama a `oc_crear`). |
| `ERROR` | Fallo al leer el paquete o inconsistencia al crear. |

**`out/log.jsonl`** contiene, mezclados y con escritura serializada, las llamadas a herramientas (campo `herramienta`) y los eventos de confirmación que escribe solo el backend (campo `evento`): `CONFIRMACION_SOLICITADA`, `CONFIRMACION_CONCEDIDA` y `CONFIRMACION_RECHAZADA`, con `ts, caso, solicitud_id, sessionId, huella, estado, confirmaciones, origen: "backend"` y, en concedida/rechazada, `decidido_por`. `CONFIRMACION_CONCEDIDA` solo se registra cuando el backend verifica a la vez el mensaje explícito del usuario, el pendiente presentado y la huella vigente; el `confirmado: true` que envía el modelo no es evidencia.

**`out/confirmaciones.json`** guarda el ciclo de cada solicitud (huella, solicitada, concedida/rechazada y `numero_oc`) y enlaza el pendiente con la OC creada.

En las pruebas reales, sol-005 y sol-006 muestran el ciclo completo (`PENDIENTE_CONFIRMACION › CREADA › IDEMPOTENTE`, con la misma huella en eventos y estado). **sol-004 y sol-001 se ejecutaron antes o sin esa auditoría**: sol-004 no tiene fila pendiente ni eventos (se ejecutó antes de B6.1) y sol-001 no requería confirmación.

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | Envía un mensaje al agente (requiere `X-Access-Key` si hay `ACCESS_KEY`). |
| `GET` | `/api/sessions/:id` | Historial y estado de una sesión (requiere `X-Access-Key` si hay `ACCESS_KEY`). |
| `GET` | `/api/health` | Estado del servidor, de la IA, acceso, persistencia y presupuesto. **Público.** |
| `GET` | `/api/diagnostico` | Cabeceras de proxy y IP efectiva, para validar `TRUST_PROXY`. Solo existe con `ACCESS_KEY` y la exige. |
| `GET` | `/`, `/app.js`, `/styles.css` | Front (lista cerrada de archivos de `web/`). |

### `POST /api/chat`

Cuerpo (`application/json`, máx. 16 KB; **solo** estos campos, cualquier otro se rechaza con 400):

```json
{ "sessionId": "demo-1", "message": "Procesa la solicitud sol-004 y no la crees hasta que yo lo confirme" }
```

`sessionId` es opcional (se genera un UUID); `message` va de 1 a 4000 caracteres. Respuesta (forma del contrato, ejemplo con un proveedor simulado; `reply` recortado):

```json
{
  "ok": true,
  "sessionId": "demo-1",
  "reply": "**Vista previa de la OC (sol-004)** …",
  "toolCalls": [
    { "herramienta": "oc_validar", "args": { "caso": "sol-004" }, "ok": true,
      "resumen": "apta=true; bloqueos=ninguno; confirmaciones=RC5; retroactiva=false" },
    { "herramienta": "oc_construir_payload", "args": { "caso": "sol-004" }, "ok": true,
      "resumen": "OC lista para Cloud Andina S.A.S.; posiciones=1; excepciones=RC5; trazabilidad=out/sol-004/trazabilidad.json" }
  ],
  "needsConfirmation": true,
  "pendiente": { "caso": "sol-004", "solicitud_id": "SOL-2026-004", "presentada": true },
  "tokens": 1000
}
```

Para confirmar, el usuario responde con texto: `{"sessionId":"demo-1","message":"Confirmo"}`. **No existe un campo de confirmación en la API**; el backend decide si ese mensaje cuenta. El front envía exactamente `Confirmo` o `No confirmo` desde sus botones.

Errores: `{ "ok": false, "error": "…" }` (en chat, además `reply`, `toolCalls`, etc.).

| Estado | Causa |
|---|---|
| 400 / 413 / 415 | Cuerpo inválido, demasiado grande o `Content-Type` incorrecto |
| 401 | Falta la clave de acceso o es incorrecta (`X-Access-Key`) |
| 403 | Origen no permitido (CORS) |
| 404 / 405 | Ruta o método inexistente |
| 429 | Límite por IP, demasiados intentos con clave inválida, límite de tokens de la sesión o proveedor limitando |
| 502 / 504 | Fallo o timeout del proveedor de IA |
| 503 | IA no configurada (falta `LLM_API_KEY`) o presupuesto global de tokens agotado |
| 500 | Error interno genérico (el detalle va solo al log del servidor) |

### `GET /api/sessions/:id`

```json
{ "ok": true, "id": "demo-1", "creada": "2026-11-13T17:47:43.435Z", "turnos": 1, "tokens": 1000,
  "needsConfirmation": true,
  "pendiente": { "caso": "sol-004", "solicitud_id": "SOL-2026-004", "presentada": true },
  "historial": [ { "rol": "user", "…": "…" }, { "rol": "tool", "herramienta": "oc_validar", "…": "…" }, { "rol": "assistant", "…": "…" } ],
  "limites": { "maxTokensSesion": 100000, "maxIteraciones": 25 } }
```

### `GET /api/health`

```json
{ "ok": true, "servidor": "activo",
  "llm": { "configurado": false, "proveedor": "anthropic", "modelo": "claude-opus-5-5",
           "motivo": "Falta la clave del proveedor de IA: defina LLM_API_KEY en el entorno del servidor." },
  "limites": { "maxIteraciones": 25, "maxTokensSesion": 100000, "timeoutMs": 60000 },
  "acceso": "abierto", "persistencia": "local" }
```

`acceso` es `"protegido"` con `ACCESS_KEY`; `persistencia` es `"efimera"` con `EPHEMERAL_STORAGE=true`; con `GLOBAL_TOKEN_BUDGET` se añade `presupuesto: {limite, consumido, reservado, disponible}`.

Sin clave, `/api/health` responde así y `/api/chat` responde 503; el servidor no se detiene.

## Limitaciones conocidas

Hallazgos de las pruebas reales y de la auditoría final (B7). Ninguno impide crear una OC sin autorización; son mejoras pendientes, no corregidas.

**Auditoría y control**
- **Los bloqueos no dejan fila `BLOQUEADA` en `control.csv` si el modelo no llama a `oc_crear`.** En sol-002 y sol-003 el agente validó, explicó el bloqueo y no intentó crear, así que esos casos no figuran en el CSV (sí en `log.jsonl`). Las filas `BLOQUEADA` de la demo aparecen porque la demo llama a `oc_crear`.
- **Entrada histórica de sol-004 anterior a B6.1:** en `confirmaciones.json` conserva el formato antiguo (solo huella y fecha; se lee sin problema) y no tiene fila `PENDIENTE_CONFIRMACION` ni eventos. Si se reprocesa en una sesión nueva, el backend registraría una fila pendiente espuria (se verificó en una copia de `out/`); no se crea una segunda OC.
- **Confirmación innecesaria al reprocesar órdenes ya creadas:** `oc_validar` marca «requiere confirmación» sin comprobar si la OC ya existe; el panel aparece, y si el usuario confirma, `oc_crear` devuelve la OC existente.

**Datos de la OC y comportamiento del modelo**
- **Descripciones truncadas a 40 caracteres (límite SAP) a mitad de palabra** en 3 de las 4 OC (p. ej. «Renovación licencias antivirus corporati»).
- **Unidad de medida inferida:** el PRD exige `UN|H|MES` pero los fixtures no la traen; se infiere por palabras clave («hora(s)» → `H`, «mensual/por mes» → `MES`, resto `UN`). En las OC reales: `UN` en tres y `H` en sol-004.
- **Descripción de los códigos de IVA incompleta:** las herramientas devuelven el código (`C1`) y su origen, pero no su descripción del maestro («IVA 19 %»). En sol-006 el modelo lo reconoció y pidió verificar que `C1` fuera el correcto.
- **Hipótesis del modelo sin respaldo de herramientas:** en sol-004 sugirió que el IVA «puede explicar» la diferencia entre cotización y solicitud, lo cual no cuadra aritméticamente; lo presentó como hipótesis y pidió confirmación del solicitante. El resto de afirmaciones con reservas eran honestas (p. ej. «las herramientas no explican qué significa C1»).
- **Sin prueba con documentos hostiles:** ningún fixture contiene inyecciones de instrucciones, así que la resistencia del modelo real a documentos maliciosos no se ha medido. (El texto de la aprobación de sol-005, «Ya llegó la factura, por favor crear la OC», se trató como dato: el modelo indicó que coincidía con la marca retroactiva pero no reemplazaba la confirmación.)

**Confirmación y acceso**
- **La confirmación es por frase de texto** (lista cerrada). Es rígida a propósito; «dale» o «ok» no confirman. La identidad del confirmante es el identificador de sesión (`sesion:<id>`): **no hay identidad por usuario** (solo la clave de acceso compartida).
- El cliente puede elegir su propio `sessionId` en `POST /api/chat`. Con `ACCESS_KEY` solo quien tenga la clave puede leer sesiones, pero todos los que la compartan pueden leer las sesiones de los demás: la clave es compartida, **no hay identidad por usuario**.

**Operación**
- **Respuesta no incremental:** el chat responde cuando termina el turno completo; las tool calls se muestran todas a la vez.
- **Persistencia en archivos y estado en memoria:** sin base de datos; el límite por IP y el presupuesto global viven en memoria del proceso; la numeración de OC se serializa solo dentro de un proceso (no entre procesos). En Render Free `out/` es efímero (ver la sección de despliegue).
- El mensaje de error de validación del cuerpo de `/api/chat` aparece en inglés para el detalle de Zod («Unrecognized key»).
- `/api/health` indica que hay clave, no que Anthropic esté disponible.
- Sin fallback ante rechazos del proveedor: un `refusal` se informa al usuario como error.

## Despliegue en Render Free

Estado: **preparado, no desplegado.** Se añadieron `Dockerfile`, `.dockerignore`, `render.yaml`, clave de acceso, presupuesto global de tokens y configuración de proxy. Se verificó localmente el arranque de producción (sección «Qué se verificó y qué no»), pero **la imagen Docker no se construyó** porque no hay Docker en la máquina de desarrollo.

### Limitaciones reales del plan Free (según la documentación de Render)

- **Sin disco persistente.** Los cambios en disco se pierden al redesplegar, reiniciar o suspender. Aquí eso significa que `out/` (órdenes, sesiones, confirmaciones, control y logs) **no sobrevive**: la numeración de OC vuelve a 4500000001 y las confirmaciones pendientes desaparecen. La UI y `/api/health` (`persistencia: "efimera"`) lo advierten. No se siembran datos de ejemplo ni se copia el `out/` local.
- **Se suspende tras 15 minutos sin tráfico**; despertarlo tarda ≈ 1 minuto. Antes de una demostración, abra `/api/health` con antelación y no redespliegue durante la sesión.
- 512 MB de RAM, 0,1 CPU, 750 horas de instancia al mes y una sola instancia (no escala horizontalmente).
- TLS lo termina el balanceador de Render y redirige HTTP a HTTPS; el servidor recibe HTTP.
- Render despliega desde un repositorio Git (o una imagen de un registro), no desde una carpeta local.

### Seguridad añadida para el link público

| Control | Cómo funciona |
|---|---|
| **Clave de acceso (`ACCESS_KEY`)** | Obligatoria con `NODE_ENV=production` (el servidor no arranca sin ella), mínimo 16 caracteres, validada en el backend. Protege `/api/chat`, `/api/sessions/:id` y `/api/diagnostico` mediante la cabecera `X-Access-Key`. `/api/health` y los archivos estáticos siguen públicos. Comparación en tiempo constante (SHA-256 + `timingSafeEqual`). Tras 10 fallos por minuto desde una IP se responde 429 (la clave correcta nunca se bloquea). |
| **Pantalla de acceso (front)** | Pide la clave, la valida contra el backend sin gastar tokens y la guarda solo en `sessionStorage` (se borra al cerrar la pestaña); viaja únicamente en la cabecera. CSP, escape de HTML y el envío exclusivo de texto de confirmación no cambian. |
| **`TRUST_PROXY` (desactivado)** | Por defecto el servidor ignora toda cabecera de proxy y usa la IP del socket. Con `TRUST_PROXY=true` toma la entrada N-ésima **desde la derecha** de `TRUST_PROXY_HEADER` (`TRUST_PROXY_HOPS`); las entradas de la izquierda (falsificables) se ignoran y, si falta o no es una IP válida, vuelve a la IP del socket. |
| **`GLOBAL_TOKEN_BUDGET`** | Tope de tokens del proceso (todas las sesiones) con reserva atómica antes de cada llamada al modelo, de modo que llamadas concurrentes no lo superen. Se reinicia con el proceso. Al agotarse, `/api/chat` responde 503. |
| **Límite del proveedor** | Configure además un límite de gasto en la consola de Anthropic: es la protección de fondo. |

### Pasos para desplegar

1. **Clave de Anthropic.** Revoque la clave usada durante el desarrollo y cree una exclusiva con límite de gasto.
2. **`ACCESS_KEY`.** Genere una clave de acceso: `openssl rand -base64 24`. Se entrega por separado a quien deba probar el link.
3. **Repositorio Git.** Con `git` operativo (en macOS puede requerir aceptar la licencia de Xcode: `sudo xcodebuild -license`), desde la carpeta del proyecto y sin sobrescribir nada:
   ```bash
   git init -b main
   git config user.name "<su nombre>"
   git config user.email "<su correo>"
   git remote add origin https://github.com/<usuario>/<repositorio>.git
   git fetch origin                      # si el remoto ya tuviera historial, inspecciónelo antes de continuar
   git status --short                    # revise qué se va a versionar
   git check-ignore -v .env out node_modules   # los tres deben aparecer como ignorados
   git ls-files | grep -E '^(\.env|out/|node_modules/)' || echo "ok: nada sensible versionado"
   git add -A && git commit -m "Reto 3: agente de órdenes de compra"
   git push -u origin main               # sin --force
   ```
   Si el remoto ya tuviera commits, en lugar de `git push` directo use `git reset --mixed origin/main` (mueve HEAD sin tocar sus archivos) antes del commit para conservar su historial. **El repositorio puede ser público: no suba `.env` ni claves, y confirme que puede publicar los materiales del reto (PRD y fixtures).**
4. **Render.** *New → Blueprint*, conecte el repositorio y Render detectará `render.yaml` (servicio web Docker, plan `free`, health check `/api/health`, despliegue **manual**). Cuando lo solicite, introduzca `LLM_API_KEY` y `ACCESS_KEY` (están declaradas con `sync: false`: nunca viajan en el repositorio). Lance el despliegue con *Manual Deploy*. (El YAML se validó solo por lectura y con pruebas estáticas; Render lo valida al crear el Blueprint. Alternativa: crear el servicio a mano con *Language: Docker* y las mismas variables.)
5. **Verificación posterior** (con la URL pública `https://<servicio>.onrender.com`):
   - `GET /api/health` → 200, `acceso: "protegido"`, `persistencia: "efimera"`.
   - `POST /api/chat` sin cabecera `X-Access-Key` → 401; con la clave correcta → 200.
   - Abrir la URL en el navegador: aparece la pantalla de acceso y, tras la clave, el chat funciona (si apareciera un 403 de «Origen no permitido», el control de mismo origen no recibe el `Host` esperado: revise `CORS_ORIGINS`).
   - **Validar el proxy:** `curl -H "X-Access-Key: $ACCESS_KEY" https://<servicio>.onrender.com/api/diagnostico` muestra `ipSocket` (hoy será la IP del balanceador, compartida por todos), las cabeceras de proxy recibidas y `urlRecibida`. Repita enviando `-H "X-Forwarded-For: 6.6.6.6"` y compare: la documentación de Render consultada **no confirma** qué cabecera lleva la IP del cliente, así que no active `TRUST_PROXY` hasta ver, en esa respuesta, la cabecera y el número de saltos reales. Luego defina `TRUST_PROXY=true`, `TRUST_PROXY_HEADER` y `TRUST_PROXY_HOPS` en el panel y repita la prueba con una cabecera falsificada. Cambiar variables redespliega y borra los datos: hágalo antes de la demostración.

### Qué se verificó y qué no

Verificado en local (sin llamadas a Anthropic):
- `bun run typecheck` y `bun test` (200 pruebas: las 151 existentes sin cambios y 49 nuevas).
- Arranque de producción con una copia con **el mismo contenido que la imagen** (solo `src`, `agent`, `web`, `fixtures`, `package.json`, `tsconfig.json` y dependencias de producción instaladas con `--frozen-lockfile --production`), con `NODE_ENV=production`, `HOST=0.0.0.0` y `PORT=10000`: escucha en `*:10000`.
- Sin `ACCESS_KEY` (o con una de menos de 16 caracteres) en producción el servidor **no arranca** y el error no revela la clave; un `HOST` vacío tampoco arranca.
- 401 sin clave o con clave incorrecta en `/api/chat`, `/api/sessions/:id` y `/api/diagnostico`; 200 con la clave correcta; `/api/health` y los estáticos públicos; la clave no aparece en respuestas, logs ni `out/`.
- Presupuesto global contabilizando los tokens y límite por IP activos; una cabecera `X-Forwarded-For` falsificada no cambia la IP efectiva con `TRUST_PROXY=false`.
- Pantalla de acceso en Chrome: clave incorrecta → mensaje y sigue bloqueado; clave correcta → el chat funciona; la clave queda solo en `sessionStorage`; una clave guardada inválida vuelve a pedirse.
- Para probar el flujo completo del chat sin consumir la API real, el servidor de producción simulado apuntó el SDK a un servidor local que imita la API de mensajes.

**No pudo verificarse** (no hay Docker local y no se desplegó):
- Que la imagen **se construya** y arranque (`docker build`), incluido el usuario `bun` de la imagen `oven/bun:1.4.4-slim` (la guía oficial de Bun usa `USER bun`, pero no se inspeccionó la variante `-slim`) y los permisos de escritura de `out/`.
- La sintaxis completa de `render.yaml` frente a Render (se comprobó con pruebas estáticas y los campos documentados).
- Qué cabecera lleva la IP del cliente en Render, si se conserva `Host` y si `RENDER_EXTERNAL_URL` está disponible en servicios Docker (el servidor ya la admite como origen CORS si existe).
- El arranque en frío real (≈ 1 minuto según Render) y el comportamiento con 512 MB / 0,1 CPU.

### Pasos manuales pendientes

1. Aceptar la licencia de Xcode y conectar la carpeta al repositorio remoto (paso 3).
2. Revocar la clave de Anthropic de desarrollo, crear la nueva y generar `ACCESS_KEY`.
3. Crear el Blueprint en Render, cargar los dos secretos y desplegar manualmente.
4. Ejecutar la verificación posterior, validar el proxy con `/api/diagnostico` y decidir `TRUST_PROXY`.
5. Despertar el servicio antes de la defensa y no redesplegar durante ella.
