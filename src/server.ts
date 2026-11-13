import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Agente, RespuestaTurno } from "./agente/ciclo.ts"
import { crearAgenteDesdeEntorno } from "./agente/fabrica.ts"
import { PresupuestoGlobal } from "./agente/presupuesto.ts"
import { ID_SESION } from "./agente/sesion.ts"
import { cargarConfig, type Config } from "./config.ts"
import { ErrorLlm } from "./llm/adapter.ts"
import { MODELO_POR_DEFECTO, redactar } from "./llm/anthropic.ts"
import { compararClaves, resolverIpCliente, type ConfianzaProxy } from "./seguridad.ts"

// ---------- Esquemas de entrada (todo body se valida; lo desconocido se rechaza) ----------

const MAX_BODY_BYTES = 16 * 1024
const ChatBodySchema = z
  .object({
    sessionId: z.string().regex(ID_SESION, "sessionId inválido (use letras, números, _ o -; máx. 64)").optional(),
    message: z.string().trim().min(1, "El mensaje no puede estar vacío").max(4000, "El mensaje supera 4000 caracteres"),
  })
  .strict()

// ---------- Opciones ----------

export type OpcionesServidor = {
  /** null = IA sin configurar (el servidor arranca igual y lo informa). */
  agente: Agente | null
  config: Config
  directory: string
  /** Orígenes externos permitidos por CORS. Vacío = solo mismo origen. */
  corsOrigins?: string[]
  secreto?: string
  motivoSinAgente?: string
  /** Máximo de mensajes de chat por IP y minuto. */
  limiteChatPorMinuto?: number
  ahora?: () => number
  /** Clave de acceso para /api/chat, /api/sessions/:id y /api/diagnostico. Por defecto, config.ACCESS_KEY; sin ella el acceso es abierto. */
  accessKey?: string
  /** Confianza en cabeceras de proxy. Por defecto, la de config (desactivada). */
  trustProxy?: ConfianzaProxy
  /** Presupuesto global de tokens (solo para informar su estado en /api/health). */
  presupuesto?: PresupuestoGlobal
  /** Almacenamiento efímero (p. ej. Render Free). Por defecto, config.EPHEMERAL_STORAGE. */
  efimero?: boolean
}

/** Fallos de clave por IP y minuto a partir de los cuales se responde 429 en vez de 401. */
const MAX_FALLOS_CLAVE_POR_MINUTO = 10

const ARCHIVOS_WEB: Record<string, { archivo: string; tipo: string }> = {
  "/": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/index.html": { archivo: "index.html", tipo: "text/html; charset=utf-8" },
  "/app.js": { archivo: "app.js", tipo: "text/javascript; charset=utf-8" },
  "/styles.css": { archivo: "styles.css", tipo: "text/css; charset=utf-8" },
}

const CABECERAS_SEGURIDAD: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

/** Código de error del agente → estado HTTP. Los mensajes ya vienen sin secretos. */
function estadoParaError(error: string | undefined): number {
  switch (error) {
    case undefined:
    case "tope_iteraciones":
    case "respuesta_vacia":
    case "rechazo":
      return 200
    case "timeout":
      return 504
    case "limite_tasa":
    case "limite_tokens":
      return 429
    case "presupuesto_global":
      return 503
    case "autenticacion":
    case "red":
    case "solicitud":
    case "proveedor":
      return 502
    default:
      return 500
  }
}

export type ManejadorHttp = (req: Request, ip?: string) => Promise<Response>

export function crearManejador(op: OpcionesServidor): ManejadorHttp {
  const origenesPermitidos = new Set(op.corsOrigins ?? [])
  const limiteChat = op.limiteChatPorMinuto ?? op.config.RATE_LIMIT_CHAT_PER_MIN
  const ahora = op.ahora ?? (() => Date.now())
  const visitas = new Map<string, number[]>()
  const fallosClave = new Map<string, number[]>()
  const claveAcceso = op.accessKey ?? op.config.ACCESS_KEY
  const confianza: ConfianzaProxy = op.trustProxy ?? {
    activo: op.config.TRUST_PROXY,
    cabecera: op.config.TRUST_PROXY_HEADER,
    saltos: op.config.TRUST_PROXY_HOPS,
  }
  const efimero = op.efimero ?? op.config.EPHEMERAL_STORAGE

  const json = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
    })
  const errorJson = (status: number, error: string, extra: Record<string, string> = {}) => json({ ok: false, error }, status, extra)

  function excedeLimite(ip: string): boolean {
    const desde = ahora() - 60_000
    const recientes = (visitas.get(ip) ?? []).filter((t) => t > desde)
    recientes.push(ahora())
    visitas.set(ip, recientes)
    return recientes.length > limiteChat
  }

  /**
   * Exige X-Access-Key (si hay clave configurada). La comparación es en tiempo constante y la clave
   * correcta NUNCA se bloquea (un atacante con claves erróneas no puede dejar fuera a usuarios válidos);
   * los fallos repetidos desde una IP pasan de 401 a 429 para frenar la fuerza bruta.
   */
  function exigirClave(req: Request, ip: string): Response | null {
    if (!claveAcceso) return null
    if (compararClaves(req.headers.get("x-access-key") ?? "", claveAcceso)) return null
    const desde = ahora() - 60_000
    const recientes = (fallosClave.get(ip) ?? []).filter((t) => t > desde)
    recientes.push(ahora())
    fallosClave.set(ip, recientes)
    if (recientes.length > MAX_FALLOS_CLAVE_POR_MINUTO) {
      return errorJson(429, "Demasiados intentos con clave inválida. Espera un momento.", { "Retry-After": "60" })
    }
    return errorJson(401, "Clave de acceso requerida o inválida.")
  }

  /** Mismo origen o lista blanca. Sin cabecera Origin (curl, navegación) se permite. */
  function origenPermitido(req: Request): { permitido: boolean; origen: string | null; externo: boolean } {
    const origen = req.headers.get("origin")
    if (!origen) return { permitido: true, origen: null, externo: false }
    if (origenesPermitidos.has(origen)) return { permitido: true, origen, externo: true }
    try {
      const mismo = new URL(origen).host === new URL(req.url).host
      return { permitido: mismo, origen, externo: false }
    } catch {
      return { permitido: false, origen, externo: false }
    }
  }

  async function leerJson(req: Request): Promise<{ ok: true; valor: unknown } | { ok: false; respuesta: Response }> {
    if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return { ok: false, respuesta: errorJson(415, "Content-Type debe ser application/json.") }
    }
    const declarado = Number(req.headers.get("content-length") ?? "0")
    if (declarado > MAX_BODY_BYTES) return { ok: false, respuesta: errorJson(413, "El cuerpo de la solicitud es demasiado grande.") }
    const texto = await req.text()
    if (new TextEncoder().encode(texto).length > MAX_BODY_BYTES) {
      return { ok: false, respuesta: errorJson(413, "El cuerpo de la solicitud es demasiado grande.") }
    }
    try {
      return { ok: true, valor: JSON.parse(texto) as unknown }
    } catch {
      return { ok: false, respuesta: errorJson(400, "El cuerpo no es un JSON válido.") }
    }
  }

  async function chat(req: Request, ip: string): Promise<Response> {
    const denegado = exigirClave(req, ip)
    if (denegado) return denegado
    if (excedeLimite(ip)) return errorJson(429, "Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.", { "Retry-After": "60" })
    const cuerpo = await leerJson(req)
    if (!cuerpo.ok) return cuerpo.respuesta
    const parsed = ChatBodySchema.safeParse(cuerpo.valor)
    if (!parsed.success) {
      return errorJson(400, `Solicitud inválida: ${parsed.error.issues.map((i) => `${i.path.join(".") || "cuerpo"}: ${i.message}`).join("; ")}`)
    }
    if (!op.agente) {
      return errorJson(503, op.motivoSinAgente ?? "El agente de IA no está configurado en el servidor.")
    }
    const sessionId = parsed.data.sessionId ?? randomUUID()
    const turno: RespuestaTurno = await op.agente.procesar(sessionId, parsed.data.message)
    const sesion = await op.agente.obtenerSesion(sessionId)
    return json(
      {
        ok: turno.ok,
        sessionId,
        reply: turno.reply,
        toolCalls: turno.toolCalls,
        needsConfirmation: turno.needsConfirmation,
        pendiente: sesion?.pendiente ?? null,
        tokens: turno.tokens,
        ...(turno.error ? { error: turno.error } : {}),
      },
      estadoParaError(turno.error),
    )
  }

  async function sesion(req: Request, ip: string, id: string): Promise<Response> {
    const denegado = exigirClave(req, ip)
    if (denegado) return denegado
    if (!ID_SESION.test(id)) return errorJson(400, "Identificador de sesión inválido.")
    if (!op.agente) return errorJson(404, "Sesión no encontrada.")
    const s = await op.agente.obtenerSesion(id)
    if (!s) return errorJson(404, "Sesión no encontrada.")
    return json({ ok: true, ...s, limites: { maxTokensSesion: op.config.MAX_TOKENS_SESION, maxIteraciones: op.config.MAX_ITERACIONES } })
  }

  function health(): Response {
    return json({
      ok: true,
      servidor: "activo",
      llm: {
        configurado: op.agente !== null,
        proveedor: op.agente?.modelo.proveedor ?? (op.config.LLM_PROVIDER || "anthropic"),
        modelo: op.agente?.modelo.modelo ?? (op.config.LLM_MODEL || MODELO_POR_DEFECTO),
        ...(op.agente ? {} : { motivo: op.motivoSinAgente ?? "Falta la clave del proveedor de IA." }),
      },
      limites: { maxIteraciones: op.config.MAX_ITERACIONES, maxTokensSesion: op.config.MAX_TOKENS_SESION, timeoutMs: op.config.LLM_TIMEOUT_MS },
      acceso: claveAcceso ? "protegido" : "abierto",
      persistencia: efimero ? "efimera" : "local",
      ...(op.presupuesto ? { presupuesto: op.presupuesto.estado } : {}),
    })
  }

  /**
   * Diagnóstico de proxy/cabeceras para validar la estrategia de TRUST_PROXY tras un despliegue.
   * Solo existe con clave de acceso configurada y la exige; no devuelve secretos (solo cabeceras de red).
   */
  function diagnostico(req: Request, ip: string, ipSocket: string): Response {
    const denegado = exigirClave(req, ip)
    if (denegado) return denegado
    const cab = (n: string) => req.headers.get(n)
    const url = new URL(req.url)
    return json({
      ok: true,
      ipSocket,
      ipEfectiva: ip,
      trustProxy: confianza,
      urlRecibida: { host: url.host, protocolo: url.protocol },
      cabeceras: Object.fromEntries(
        ["host", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "forwarded", "cf-connecting-ip", "true-client-ip", "origin"].map((n) => [n, cab(n)]),
      ),
    })
  }

  async function estatico(ruta: string): Promise<Response | null> {
    const entrada = ARCHIVOS_WEB[ruta] // lista cerrada: no hay forma de salir de web/
    if (!entrada) return null
    const f = Bun.file(`${op.directory}/web/${entrada.archivo}`)
    if (!(await f.exists())) return errorJson(404, "Recurso no encontrado.")
    return new Response(f, { headers: { "Content-Type": entrada.tipo, "Cache-Control": "no-cache" } })
  }

  async function enrutar(req: Request, ip: string, ipSocket: string): Promise<Response> {
    const url = new URL(req.url)
    const ruta = url.pathname
    const metodo = req.method

    if (ruta === "/api/health") return metodo === "GET" ? health() : errorJson(405, "Método no permitido.", { Allow: "GET" })
    if (ruta === "/api/chat") return metodo === "POST" ? chat(req, ip) : errorJson(405, "Método no permitido.", { Allow: "POST, OPTIONS" })
    const m = /^\/api\/sessions\/([^/]+)$/.exec(ruta)
    if (m) return metodo === "GET" ? sesion(req, ip, decodeURIComponent(m[1] ?? "")) : errorJson(405, "Método no permitido.", { Allow: "GET" })
    if (ruta === "/api/diagnostico" && claveAcceso) return metodo === "GET" ? diagnostico(req, ip, ipSocket) : errorJson(405, "Método no permitido.", { Allow: "GET" })
    if (ruta.startsWith("/api/")) return errorJson(404, "Ruta no encontrada.")

    if (metodo === "GET" || metodo === "HEAD") return (await estatico(ruta)) ?? errorJson(404, "Recurso no encontrado.")
    return errorJson(405, "Método no permitido.", { Allow: "GET" })
  }

  return async (req, ipSocket = "local") => {
    const ip = resolverIpCliente(req.headers, ipSocket, confianza)
    const origen = origenPermitido(req)
    let respuesta: Response
    if (!origen.permitido) {
      respuesta = errorJson(403, "Origen no permitido.")
    } else if (req.method === "OPTIONS") {
      respuesta = new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } })
      if (origen.externo && origen.origen) {
        respuesta.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        respuesta.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Access-Key")
        respuesta.headers.set("Access-Control-Max-Age", "600")
      }
    } else {
      try {
        respuesta = await enrutar(req, ip, ipSocket)
      } catch (e) {
        // Detalle solo en el log del servidor y sin secretos; el cliente recibe un mensaje genérico.
        console.error("[error]", redactar(e instanceof Error ? e.message : String(e), op.secreto))
        respuesta = errorJson(500, "Error interno del servidor.")
      }
    }
    for (const [k, v] of Object.entries(CABECERAS_SEGURIDAD)) respuesta.headers.set(k, v)
    if (origen.externo && origen.origen) {
      respuesta.headers.set("Access-Control-Allow-Origin", origen.origen)
      respuesta.headers.append("Vary", "Origin")
    }
    return respuesta
  }
}

// ---------- Arranque ----------

/** Origen (esquema + host) de una URL pública, para aceptarlo en CORS. Vacío o inválido → ninguno. */
function origenExterno(url: string | undefined): string[] {
  if (!url) return []
  try {
    return [new URL(url).origin]
  } catch {
    return []
  }
}

export async function iniciarServidor(env: Record<string, string | undefined> = process.env) {
  const directory = import.meta.dir.replace(/\/src$/, "")
  const config = cargarConfig(env)
  const presupuesto = config.GLOBAL_TOKEN_BUDGET ? new PresupuestoGlobal(config.GLOBAL_TOKEN_BUDGET) : undefined
  const agente = await crearAgenteDesdeEntorno(directory, env, presupuesto ? { presupuesto } : {})
  const secreto = env.LLM_API_KEY || env.ANTHROPIC_API_KEY
  const sinAgente = agente instanceof ErrorLlm
  const manejador = crearManejador({
    agente: sinAgente ? null : agente,
    config,
    directory,
    corsOrigins: [...(env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter((s) => s !== ""), ...origenExterno(env.RENDER_EXTERNAL_URL)],
    ...(presupuesto ? { presupuesto } : {}),
    ...(secreto ? { secreto } : {}),
    ...(sinAgente ? { motivoSinAgente: agente.message } : {}),
  })
  if (config.NODE_ENV === "production" && !config.ACCESS_KEY) {
    console.warn(`⚠ ACCESO ABIERTO (ALLOW_OPEN_ACCESS=true): cualquiera con el enlace puede usar el agente y consumir la clave de IA. Límites activos: ${config.RATE_LIMIT_CHAT_PER_MIN} mensajes/min por IP y presupuesto global ${presupuesto ? presupuesto.limite : "SIN TOPE"} tokens.`)
  }
  const servidor = Bun.serve({
    port: config.PORT,
    hostname: config.HOST,
    // Una respuesta del agente puede tardar más que el idleTimeout por defecto (10 s).
    idleTimeout: 120,
    fetch: (req, srv) => manejador(req, srv.requestIP(req)?.address),
  })
  console.log(`Servidor en http://${servidor.hostname}:${servidor.port}  ·  IA: ${sinAgente ? `NO configurada (${agente.message})` : "configurada"}  ·  acceso: ${config.ACCESS_KEY ? "protegido" : "ABIERTO"}  ·  proxy de confianza: ${config.TRUST_PROXY ? `sí (${config.TRUST_PROXY_HEADER}, saltos=${config.TRUST_PROXY_HOPS})` : "no"}  ·  presupuesto global: ${presupuesto ? presupuesto.limite : "sin tope"}  ·  almacenamiento: ${config.EPHEMERAL_STORAGE ? "efímero" : "local"}`)
  return servidor
}

if (import.meta.main) await iniciarServidor()
