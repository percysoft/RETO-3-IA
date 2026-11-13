import { resolverContexto, type ToolContext } from "../core/contexto.ts"
import { rechazarConfirmacion, solicitarConfirmacion, validarCaso } from "../core/servicio.ts"
import {
  ErrorLlm,
  type Bloque,
  type BloqueResultadoHerramienta,
  type BloqueUsoHerramienta,
  type LlmAdapter,
} from "../llm/adapter.ts"
import { redactar } from "../llm/anthropic.ts"
import { esConfirmacionExplicita, esRechazoExplicito } from "./confirmacion.ts"
import {
  MAX_LLAMADAS_POR_RESPUESTA,
  definicionesParaModelo,
  marcarNoConfiable,
  validarLlamada,
} from "./herramientas.ts"
import { registrarLlamada } from "./log.ts"
import type { PresupuestoGlobal } from "./presupuesto.ts"
import { AlmacenSesiones, ID_SESION, type Sesion } from "./sesion.ts"

export type OpcionesAgente = {
  directory: string
  outDir?: string
  llm: LlmAdapter
  /** Prompt + conocimiento ya combinados. */
  sistema: string
  maxIteraciones: number
  maxTokensSesion: number
  timeoutMs: number
  maxTokensRespuesta?: number
  /** Clave a redactar en cualquier texto que salga del backend. */
  secreto?: string
  dependencias?: Pick<ToolContext, "sap" | "ahora">
  /** Tope global de tokens (todas las sesiones). Sin él no hay tope global. */
  presupuesto?: PresupuestoGlobal
}

export type LlamadaVisible = { herramienta: string; args: unknown; ok: boolean; resumen: string }

export type RespuestaTurno = {
  ok: boolean
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  tokens: number
  error?: string
}

const MAX_MENSAJE = 4000
type Resultado = { ok?: boolean; error?: string; data?: Record<string, unknown> }

function resumir(nombre: string, r: Resultado, bruto: string): string {
  if (r.ok === false) return `error: ${r.error ?? "desconocido"}`
  const d = r.data ?? {}
  const codigos = (x: unknown) => (Array.isArray(x) ? x.map((h: { codigo?: string }) => h.codigo ?? "?").join(",") || "ninguno" : "n/a")
  if (nombre === "oc_validar") {
    return `apta=${String(d.apta)}; bloqueos=${codigos(d.bloqueos)}; confirmaciones=${codigos(d.confirmaciones)}; retroactiva=${String(d.retroactiva)}`
  }
  if (nombre === "oc_crear") return `OC ${String(d.numero_oc)} (idempotente=${String(d.idempotente)})`
  if (nombre === "oc_construir_payload") {
    const o = d.orden as { proveedor?: { nombre?: string }; posiciones?: unknown[]; excepciones?: { codigo: string }[] } | undefined
    const exc = o?.excepciones?.map((e) => e.codigo).join(",") || "ninguna"
    return `OC lista para ${o?.proveedor?.nombre ?? "?"}; posiciones=${o?.posiciones?.length ?? 0}; excepciones=${exc}; trazabilidad=${String(d.ruta_trazabilidad)}`
  }
  if (nombre === "oc_generar_evidencia") return `evidencia=${String(d.ruta)}; sha256=${String(d.sha256).slice(0, 12)}…`
  if (nombre === "oc_leer_paquete") {
    const s = d.solicitud as { solicitud_id?: string } | undefined
    const falta = Array.isArray(d.faltantes) && d.faltantes.length > 0 ? d.faltantes.join(",") : "ninguno"
    return `paquete ${s?.solicitud_id ?? "?"}; faltantes=${falta}; factura=${d.factura ? "sí" : "no"}`
  }
  return bruto.slice(0, 300)
}

export class Agente {
  private readonly almacen: AlmacenSesiones
  private readonly outDir: string
  private readonly turnosEnCurso = new Map<string, Promise<unknown>>()

  constructor(private readonly op: OpcionesAgente) {
    this.outDir = op.outDir ?? `${op.directory}/out`
    this.almacen = new AlmacenSesiones(this.outDir)
  }

  get modelo(): { proveedor: string; modelo: string } {
    return { proveedor: this.op.llm.proveedor, modelo: this.op.llm.modelo }
  }

  /** Estado recuperable de una sesión (historial visible, tokens, confirmación pendiente). */
  async obtenerSesion(id: string) {
    const s = await this.almacen.obtener(id, false)
    if (!s) return null
    return {
      id: s.id,
      creada: s.creada,
      turnos: s.turnos,
      tokens: s.tokens,
      needsConfirmation: s.pendiente?.presentada === true,
      pendiente: s.pendiente,
      historial: s.historial,
    }
  }

  /** Un turno a la vez por sesión: los mensajes concurrentes se encolan. */
  procesar(sessionId: string, texto: string, usuario?: string): Promise<RespuestaTurno> {
    const previo = this.turnosEnCurso.get(sessionId) ?? Promise.resolve()
    const turno = previo.then(() => this.turno(sessionId, texto, usuario))
    const cola = turno.catch(() => undefined)
    this.turnosEnCurso.set(sessionId, cola)
    void cola.then(() => {
      if (this.turnosEnCurso.get(sessionId) === cola) this.turnosEnCurso.delete(sessionId)
    })
    return turno
  }

  private fallo(error: string, extra: Partial<RespuestaTurno> = {}): RespuestaTurno {
    const e = redactar(error, this.op.secreto)
    return { ok: false, reply: e, toolCalls: [], needsConfirmation: false, tokens: 0, error: e, ...extra }
  }

  private async turno(sessionId: string, texto: string, usuario?: string): Promise<RespuestaTurno> {
    try {
      if (!ID_SESION.test(sessionId)) return this.fallo("Identificador de sesión inválido.")
      const mensaje = texto.trim()
      if (mensaje === "") return this.fallo("El mensaje está vacío.")
      if (mensaje.length > MAX_MENSAJE) return this.fallo(`El mensaje supera el máximo de ${MAX_MENSAJE} caracteres.`)
      const sesion = await this.almacen.obtener(sessionId, true)
      if (!sesion) return this.fallo("No se pudo abrir la sesión.")
      try {
        return await this.ejecutarTurno(sesion, mensaje, usuario ?? `sesion:${sessionId}`)
      } finally {
        await this.almacen.guardar(sesion).catch(() => undefined)
      }
    } catch (e) {
      console.error("[agente]", redactar(e instanceof Error ? e.message : String(e), this.op.secreto))
      return this.fallo("Error interno del agente.")
    }
  }

  private async ejecutarTurno(sesion: Sesion, mensaje: string, usuario: string): Promise<RespuestaTurno> {
    const ahora = () => new Date().toISOString()
    const llamadas: LlamadaVisible[] = []
    const cierre = (reply: string, extra: Partial<RespuestaTurno> = {}): RespuestaTurno => {
      const limpio = redactar(reply, this.op.secreto)
      sesion.historial.push({ ts: ahora(), rol: "assistant", texto: limpio })
      return { ok: true, reply: limpio, toolCalls: llamadas, needsConfirmation: sesion.pendiente?.presentada === true, tokens: sesion.tokens, ...extra }
    }

    if (sesion.tokens >= this.op.maxTokensSesion) {
      return cierre(`Se alcanzó el límite de tokens de esta sesión (${this.op.maxTokensSesion}). Inicia una sesión nueva para continuar.`, { ok: false, error: "limite_tokens" })
    }

    // La confirmación se decide AQUÍ, con el estado de la sesión previo a este mensaje.
    const pendienteInicio = sesion.pendiente?.presentada === true ? { ...sesion.pendiente } : null
    const confirmacionValida = pendienteInicio !== null && esConfirmacionExplicita(mensaje)
    if (sesion.pendiente && esRechazoExplicito(mensaje)) {
      // Rechazo explícito: si la solicitud ya se había presentado, el backend lo audita; no se crea ninguna OC.
      if (sesion.pendiente.presentada) {
        await rechazarConfirmacion(this.contextoCore(sesion.id), sesion.pendiente.caso, usuario).catch(() => undefined)
      }
      sesion.pendiente = null
    }

    sesion.turnos += 1
    sesion.historial.push({ ts: ahora(), rol: "user", texto: mensaje })
    sesion.mensajes.push({ rol: "user", bloques: [{ tipo: "texto", texto: mensaje }] })

    const herramientas = definicionesParaModelo()

    for (let iteracion = 0; iteracion < this.op.maxIteraciones; iteracion++) {
      if (sesion.tokens >= this.op.maxTokensSesion) {
        return cierre(`Se alcanzó el límite de tokens de la sesión (${this.op.maxTokensSesion}). Lo ya ejecutado quedó registrado; inicia una sesión nueva para continuar.`, { ok: false, error: "limite_tokens" })
      }
      // Reserva atómica ANTES de llamar al modelo: las llamadas concurrentes no pueden superar el tope global.
      const presupuesto = this.op.presupuesto
      const reserva = presupuesto ? presupuesto.reservar() : 0
      if (reserva === null) {
        return cierre("El servicio alcanzó su presupuesto global de tokens y no puede atender más mensajes por ahora. Lo ya ejecutado quedó registrado.", { ok: false, error: "presupuesto_global" })
      }
      let respuesta
      try {
        respuesta = await this.op.llm.enviar({
          sistema: this.op.sistema,
          mensajes: sesion.mensajes,
          herramientas,
          maxTokensRespuesta: this.op.maxTokensRespuesta ?? 8000,
          timeoutMs: this.op.timeoutMs,
        })
      } catch (e) {
        presupuesto?.liquidar(reserva, 0)
        const msg = e instanceof ErrorLlm ? e.message : "Error inesperado del proveedor de IA."
        return cierre(`No pude continuar: ${msg} La sesión sigue activa; puedes reintentar.`, { ok: false, error: e instanceof ErrorLlm ? e.tipo : "proveedor" })
      }
      presupuesto?.liquidar(reserva, respuesta.tokens)
      sesion.tokens += respuesta.tokens

      const texto = respuesta.bloques.filter((b): b is Extract<Bloque, { tipo: "texto" }> => b.tipo === "texto").map((b) => b.texto).join("\n").trim()
      const usos = respuesta.bloques.filter((b): b is BloqueUsoHerramienta => b.tipo === "uso_herramienta")

      if (usos.length === 0) {
        if (respuesta.bloques.length > 0) sesion.mensajes.push({ rol: "assistant", bloques: respuesta.bloques })
        if (respuesta.motivo === "rechazo") return cierre(texto || "El proveedor de IA declinó responder a esta solicitud.", { ok: false, error: "rechazo" })
        const aviso = respuesta.motivo === "limite_respuesta" ? "\n\n(La respuesta se cortó por longitud; pídeme continuar.)" : ""
        if (texto === "") return cierre("No obtuve una respuesta del modelo; intenta de nuevo.", { ok: false, error: "respuesta_vacia" })
        // Turno cerrado con normalidad: si hay confirmaciones pendientes, ya se le mostraron al usuario.
        if (sesion.pendiente && !sesion.pendiente.presentada) {
          sesion.pendiente.presentada = true
          // El turno se cerró mostrando la solicitud de confirmación: el backend la audita (una vez por huella).
          await solicitarConfirmacion(this.contextoCore(sesion.id), sesion.pendiente.caso).catch(() => undefined)
        }
        return cierre(texto + aviso)
      }

      sesion.mensajes.push({ rol: "assistant", bloques: respuesta.bloques })
      if (texto !== "") sesion.historial.push({ ts: ahora(), rol: "assistant", texto: redactar(texto, this.op.secreto) })

      const resultados: BloqueResultadoHerramienta[] = []
      for (const [i, uso] of usos.entries()) {
        if (i >= MAX_LLAMADAS_POR_RESPUESTA) {
          resultados.push({ tipo: "resultado_herramienta", id: uso.id, contenido: JSON.stringify({ ok: false, error: "Demasiadas llamadas a herramientas en una sola respuesta." }), esError: true })
          continue
        }
        resultados.push(await this.ejecutarHerramienta(sesion, uso, { pendienteInicio, confirmacionValida, usuario }, llamadas))
      }
      sesion.mensajes.push({ rol: "user", bloques: resultados })
    }

    const hechas = llamadas.map((l) => `${l.herramienta}: ${l.resumen}`).join("; ")
    return cierre(`Alcancé el tope de ${this.op.maxIteraciones} pasos en este turno sin terminar. Lo hecho: ${hechas || "nada"}. Dime cómo continuar.`, { ok: false, error: "tope_iteraciones" })
  }

  private async ejecutarHerramienta(
    sesion: Sesion,
    uso: BloqueUsoHerramienta,
    estado: { pendienteInicio: { caso: string } | null; confirmacionValida: boolean; usuario: string },
    llamadas: LlamadaVisible[],
  ): Promise<BloqueResultadoHerramienta> {
    const inicio = Date.now()
    const v = validarLlamada(uso.nombre, uso.entrada)
    let bruto: string
    if (!v.ok) {
      bruto = JSON.stringify({ ok: false, error: v.error })
    } else {
      const ctx: ToolContext = {
        directory: this.op.directory,
        sessionId: sesion.id,
        outDir: this.outDir,
        ...this.op.dependencias,
        // Única vía por la que existe `confirmacionHumana`: mensaje explícito del usuario + caso pendiente ya presentado.
        ...(v.herramienta.nombre === "oc_crear" && estado.confirmacionValida && estado.pendienteInicio?.caso === v.args.caso
          ? { confirmacionHumana: { por: estado.usuario } }
          : {}),
      }
      try {
        bruto = await v.herramienta.ejecutar(v.args, ctx)
      } catch (e) {
        bruto = JSON.stringify({ ok: false, error: `Error inesperado en ${uso.nombre}: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
    bruto = redactar(bruto, this.op.secreto)
    let parseado: Resultado
    try {
      parseado = JSON.parse(bruto) as Resultado
    } catch {
      parseado = { ok: false, error: "Respuesta de herramienta ilegible." }
    }
    const ok = parseado.ok === true
    if (v.ok) await this.actualizarPendiente(sesion, uso.nombre, v.args.caso, parseado)

    const resumen = resumir(uso.nombre, parseado, bruto)
    llamadas.push({ herramienta: uso.nombre, args: uso.entrada, ok, resumen })
    sesion.historial.push({ ts: new Date().toISOString(), rol: "tool", herramienta: uso.nombre, args: uso.entrada, ok, resumen })
    await registrarLlamada(this.outDir, { ts: new Date().toISOString(), sessionId: sesion.id, herramienta: uso.nombre, args: uso.entrada, ok, resumen, ms: Date.now() - inicio }, this.op.secreto)
    return { tipo: "resultado_herramienta", id: uso.id, contenido: marcarNoConfiable(uso.nombre, bruto), esError: !ok }
  }

  private contextoCore(sessionId: string) {
    return resolverContexto({ directory: this.op.directory, sessionId, outDir: this.outDir, ...this.op.dependencias })
  }

  /** El estado de confirmación lo fija el backend a partir de los resultados, no el modelo. */
  private async actualizarPendiente(sesion: Sesion, nombre: string, caso: string, r: Resultado): Promise<void> {
    if (nombre === "oc_validar" && r.ok === true) {
      if (r.data?.confirmacion_requerida === true) {
        if (sesion.pendiente?.caso !== caso) {
          sesion.pendiente = { caso, solicitud_id: String(r.data.solicitud_id), presentada: false }
        }
      } else if (sesion.pendiente?.caso === caso) {
        sesion.pendiente = null
      }
      return
    }
    if (nombre !== "oc_crear") return
    if (r.ok === true) {
      if (sesion.pendiente?.caso === caso) sesion.pendiente = null
      return
    }
    if (sesion.pendiente?.caso !== caso) {
      // crear sin validar previo: el backend calcula por su cuenta si el caso requiere confirmación.
      const ctx = resolverContexto({ directory: this.op.directory, sessionId: sesion.id, outDir: this.outDir, ...this.op.dependencias })
      const v = await validarCaso(ctx, caso)
      if (v.ok && v.data.confirmacion_requerida) {
        sesion.pendiente = { caso, solicitud_id: v.data.solicitud_id, presentada: false }
      }
    }
  }
}

/** Construye el prompt de sistema: comportamiento (agent/prompt.md) + conocimiento (src/knowledge). */
export async function cargarSistema(directory: string): Promise<string> {
  const prompt = await Bun.file(`${directory}/agent/prompt.md`).text()
  const conocimiento = await Bun.file(`${directory}/src/knowledge/ordenes-compra.md`).text()
  return `${prompt.trim()}\n\n---\n\n# Conocimiento del proceso (referencia)\n\n${conocimiento.trim()}\n`
}
