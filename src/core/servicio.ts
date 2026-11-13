import { registrarEvento, type TipoEvento } from "./auditoria.ts"
import type { Contexto } from "./contexto.ts"
import { registrarIntento, type ResultadoIntento } from "./control.ts"
import { estaPendientePresentada, huellaConfirmaciones, marcarEtapa, registrarPendiente, type CampoCiclo } from "./confirmaciones.ts"
import { generarEvidencia, type Evidencia } from "./evidencia.ts"
import { cargarMaestros } from "./maestros.ts"
import { leerPaquete } from "./paquete.ts"
import { construirPayload, guardarTrazabilidad, type Trazabilidad } from "./payload.ts"
import { fallo, ok, type Resultado } from "./resultado.ts"
import type { Maestros, OrdenCompra, Paquete, Validacion } from "./tipos.ts"
import { validar } from "./validar.ts"

/** Todo lo que el backend deriva por sí mismo a partir del nombre del caso. */
export type CasoPreparado = { paquete: Paquete; maestros: Maestros; validacion: Validacion }

export async function prepararCaso(ctx: Contexto, caso: string): Promise<Resultado<CasoPreparado>> {
  const paquete = await leerPaquete(ctx.directory, caso)
  if (!paquete.ok) return paquete
  const maestros = await cargarMaestros(ctx.directory)
  if (!maestros.ok) return maestros
  return ok({ paquete: paquete.data, maestros: maestros.data, validacion: validar({ paquete: paquete.data, maestros: maestros.data }) })
}

export type ValidacionCaso = Validacion & { solicitud_id: string; faltantes: string[]; confirmacion_requerida: boolean }

/** oc_validar: valida y, si hay confirmaciones, deja constancia (backend) de que se presentaron. */
export async function validarCaso(ctx: Contexto, caso: string): Promise<Resultado<ValidacionCaso>> {
  const p = await prepararCaso(ctx, caso)
  if (!p.ok) return p
  const { paquete, validacion } = p.data
  if (validacion.apta && validacion.confirmaciones.length > 0) {
    await registrarPendiente(
      ctx.outDir,
      paquete.solicitud.solicitud_id,
      huellaConfirmaciones(paquete, validacion),
      ctx.ahora().toISOString(),
    )
  }
  return ok({
    ...validacion,
    solicitud_id: paquete.solicitud.solicitud_id,
    faltantes: paquete.faltantes,
    confirmacion_requerida: validacion.apta && validacion.confirmaciones.length > 0,
  })
}

type Fase = "SOLICITADA" | "CONCEDIDA" | "RECHAZADA"
const FASES: Record<Fase, { evento: TipoEvento; estado: "PENDIENTE" | "CONCEDIDA" | "RECHAZADA"; campo: CampoCiclo }> = {
  SOLICITADA: { evento: "CONFIRMACION_SOLICITADA", estado: "PENDIENTE", campo: "solicitada" },
  CONCEDIDA: { evento: "CONFIRMACION_CONCEDIDA", estado: "CONCEDIDA", campo: "concedida" },
  RECHAZADA: { evento: "CONFIRMACION_RECHAZADA", estado: "RECHAZADA", campo: "rechazada" },
}

/**
 * Auditoría de la confirmación (solo backend). Escribe el evento en log.jsonl y, para solicitud y
 * rechazo, la fila de control.csv. Es idempotente por (solicitud_id, huella, etapa): una misma etapa
 * no se registra dos veces. Devuelve true si registró algo nuevo.
 */
async function auditar(ctx: Contexto, caso: string, p: CasoPreparado, fase: Fase, decididoPor?: string): Promise<boolean> {
  const { paquete, validacion } = p
  const id = paquete.solicitud.solicitud_id
  const huella = huellaConfirmaciones(paquete, validacion)
  const ts = ctx.ahora().toISOString()
  const f = FASES[fase]
  if (fase === "SOLICITADA") await registrarPendiente(ctx.outDir, id, huella, ts)
  if (!(await marcarEtapa(ctx.outDir, id, huella, f.campo, ts))) return false
  const codigos = validacion.confirmaciones.map((c) => c.codigo)
  await registrarEvento(ctx.outDir, {
    ts, evento: f.evento, caso, solicitud_id: id, sessionId: ctx.sessionId, huella, estado: f.estado,
    confirmaciones: codigos, origen: "backend", ...(decididoPor ? { decidido_por: decididoPor } : {}),
  })
  if (fase !== "CONCEDIDA") {
    await registrarIntento(ctx.outDir, {
      solicitud_id: id, resultado: fase === "SOLICITADA" ? "PENDIENTE_CONFIRMACION" : "RECHAZADA", numero_oc: null,
      retroactiva: validacion.retroactiva, bloqueos: [], confirmaciones: codigos, ts,
    })
  }
  return true
}

async function conConfirmacionPendiente(ctx: Contexto, caso: string): Promise<CasoPreparado | null> {
  const p = await prepararCaso(ctx, caso)
  return p.ok && p.data.validacion.apta && p.data.validacion.confirmaciones.length > 0 ? p.data : null
}

/**
 * El backend dio por PRESENTADA al usuario la solicitud de confirmación (el agente cerró el turno con ella).
 * Solo registra si el caso es apto, tiene confirmaciones y no consta ya para la misma huella.
 */
export async function solicitarConfirmacion(ctx: Contexto, caso: string): Promise<Resultado<{ registrada: boolean }>> {
  const p = await conConfirmacionPendiente(ctx, caso)
  return ok({ registrada: p ? await auditar(ctx, caso, p, "SOLICITADA") : false })
}

/** El usuario rechazó explícitamente una confirmación presentada: se audita y no se crea ninguna OC. */
export async function rechazarConfirmacion(ctx: Contexto, caso: string, decididoPor: string): Promise<Resultado<{ registrada: boolean }>> {
  const p = await conConfirmacionPendiente(ctx, caso)
  return ok({ registrada: p ? await auditar(ctx, caso, p, "RECHAZADA", decididoPor) : false })
}

export async function evidenciaCaso(ctx: Contexto, caso: string): Promise<Resultado<Evidencia>> {
  const p = await leerPaquete(ctx.directory, caso)
  if (!p.ok) return p
  return generarEvidencia(ctx.outDir, caso, p.data)
}

export type PayloadCaso = { orden: OrdenCompra; trazabilidad: Trazabilidad; ruta_trazabilidad: string; evidencia: Evidencia }

/** Orden correcto: evidencia (hash) → payload (usa el hash) → trazabilidad. */
async function armarPayload(
  ctx: Contexto,
  caso: string,
  p: CasoPreparado,
  confirmadoPor: string | null,
): Promise<Resultado<PayloadCaso>> {
  if (!p.validacion.apta) {
    const lista = p.validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle}`).join(" | ")
    return fallo(`La solicitud tiene bloqueos y no se puede construir la OC. ${lista}`)
  }
  const evidencia = await generarEvidencia(ctx.outDir, caso, p.paquete)
  if (!evidencia.ok) return evidencia
  const r = construirPayload({ ...p, evidenciaSha256: evidencia.data.sha256, confirmadoPor })
  if (!r.ok) return r
  const ruta = await guardarTrazabilidad(ctx.outDir, caso, r.data.trazabilidad)
  return ok({ ...r.data, ruta_trazabilidad: ruta, evidencia: evidencia.data })
}

export async function payloadCaso(ctx: Contexto, caso: string): Promise<Resultado<PayloadCaso>> {
  const p = await prepararCaso(ctx, caso)
  if (!p.ok) return p
  return armarPayload(ctx, caso, p.data, null)
}

export type OcCreada = { numero_oc: string; fecha: string; idempotente: boolean }

const sinConfirmante = (o: OrdenCompra): string =>
  canonico({ ...o, excepciones: o.excepciones.map((x) => ({ ...x, confirmado_por: null })) })

/**
 * HU-5. El backend decide todo: relee y revalida desde disco; `confirmado` es solo la intención
 * del consumidor y se acepta únicamente si el backend presentó antes esas mismas confirmaciones
 * (huella) y el canal humano (`ctx.confirmacionHumana`) la respalda.
 */
export async function crearOc(
  ctx: Contexto,
  args: { caso: string; payload?: unknown; confirmado?: boolean },
): Promise<Resultado<OcCreada>> {
  const { caso } = args
  const intento = (
    solicitud_id: string,
    resultado: ResultadoIntento,
    extra: { numero_oc?: string; v?: Validacion } = {},
  ) =>
    registrarIntento(ctx.outDir, {
      solicitud_id,
      resultado,
      numero_oc: extra.numero_oc ?? null,
      retroactiva: extra.v?.retroactiva ?? false,
      bloqueos: extra.v?.bloqueos.map((b) => b.codigo) ?? [],
      confirmaciones: extra.v?.confirmaciones.map((c) => c.codigo) ?? [],
      ts: ctx.ahora().toISOString(),
    })

  const p = await prepararCaso(ctx, caso)
  if (!p.ok) {
    await intento(caso, "ERROR")
    return p
  }
  const { paquete, validacion } = p.data
  const id = paquete.solicitud.solicitud_id

  const existente = await ctx.sap.buscarOrdenPorReferencia(id)
  if (existente) {
    await intento(id, "IDEMPOTENTE", { numero_oc: existente.numero_oc, v: validacion })
    return ok({ numero_oc: existente.numero_oc, fecha: existente.fecha ?? "", idempotente: true })
  }

  if (!validacion.apta) {
    await intento(id, "BLOQUEADA", { v: validacion })
    const lista = validacion.bloqueos.map((b) => `${b.codigo}: ${b.detalle} → ${b.accion_sugerida}`).join(" | ")
    return fallo(`OC bloqueada, no se crea. ${lista}`)
  }

  let confirmadoPor: string | null = null
  const huella = huellaConfirmaciones(paquete, validacion)
  if (validacion.confirmaciones.length > 0) {
    const presentada = await estaPendientePresentada(ctx.outDir, id, huella)
    if (args.confirmado === true && presentada && ctx.confirmacionHumana) {
      // Concesión: mensaje explícito del usuario (ctx del backend) + pendiente presentado + huella vigente.
      confirmadoPor = ctx.confirmacionHumana.por
      await auditar(ctx, caso, p.data, "CONCEDIDA", confirmadoPor)
    } else {
      await auditar(ctx, caso, p.data, "SOLICITADA")
      const lista = validacion.confirmaciones.map((c) => `${c.codigo}: ${c.detalle}`).join(" | ")
      return fallo(`Requiere confirmación humana antes de crear la OC. ${lista}`)
    }
  }

  const armado = await armarPayload(ctx, caso, p.data, confirmadoPor)
  if (!armado.ok) {
    await intento(id, "ERROR", { v: validacion })
    return armado
  }
  const { orden } = armado.data
  if (args.payload !== undefined && sinConfirmante(orden) !== canonico(normalizarRecibido(args.payload))) {
    await intento(id, "ERROR", { v: validacion })
    return fallo("El payload recibido no coincide con el que el backend validó. Solicite de nuevo oc_construir_payload.")
  }

  const prov = await ctx.sap.consultarProveedor(orden.proveedor.nit)
  if (!prov || !prov.activo || prov.codigo_sap !== orden.proveedor.codigo_sap) {
    await intento(id, "ERROR", { v: validacion })
    return fallo("SAP no confirma el proveedor como activo con el mismo código; no se crea la OC.")
  }

  const creada = await ctx.sap.crearOrden(orden)
  if (confirmadoPor !== null) await marcarEtapa(ctx.outDir, id, huella, "numero_oc", creada.numero_oc)
  await intento(id, "CREADA", { numero_oc: creada.numero_oc, v: validacion })
  return ok({ ...creada, idempotente: false })
}

/** Lleva el payload recibido a la misma forma canónica (sin confirmantes) para compararlo. */
function normalizarRecibido(recibido: unknown): unknown {
  if (typeof recibido !== "object" || recibido === null) return recibido
  const o = recibido as Record<string, unknown>
  const exc = Array.isArray(o.excepciones) ? o.excepciones : []
  return {
    ...o,
    excepciones: exc.map((x) => (typeof x === "object" && x !== null ? { ...(x as object), confirmado_por: null } : x)),
  }
}

/** JSON con claves ordenadas: compara estructuras sin depender del orden de propiedades. */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}
