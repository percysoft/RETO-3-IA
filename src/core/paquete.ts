import { AprobacionJsonSchema, CorreoSchema, SolicitudSchema, type Paquete } from "./tipos.ts"
import { normalizarFecha, normalizarMonto, normalizarNit, sumarDias } from "./normalizar.ts"
import { fallo, mensajeDeError, ok, type Resultado } from "./resultado.ts"
import { casoValido, rutaCaso } from "./rutas.ts"

type Archivo = { ruta: string; nombre: string }

async function leerTexto(a: Archivo): Promise<string | null> {
  const f = Bun.file(a.ruta)
  return (await f.exists()) ? f.text() : null
}

async function leerJson(a: Archivo): Promise<unknown | null> {
  const texto = await leerTexto(a)
  if (texto === null) return null
  try {
    return JSON.parse(texto) as unknown
  } catch {
    throw new Error(`${a.nombre} no es un JSON válido`)
  }
}

function primero(texto: string, patron: RegExp): string | null {
  return patron.exec(texto)?.[1]?.trim() ?? null
}

/** "Aprobado" afirmativo; se descartan negaciones como "no aprobado" o "sin aprobar". */
export function esAprobado(cuerpo: string): boolean {
  const t = cuerpo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
  if (!/\baprobad[oa]\b/.test(t)) return false
  return !/\b(no|sin|nunca|rechaz\w*|desaprob\w*)\s+(\w+\s+)?aprobad[oa]\b/.test(t)
}

export function parsearCotizacion(texto: string): Paquete["cotizacion"] {
  const total = /^\s*TOTAL\b[^:\n]*:\s*(?:(COP|USD)\s*)?([\d.,]+)/im.exec(texto)
  const monto = total ? normalizarMonto(total[2]) : null
  if (!total || monto === null) throw new Error("cotizacion.txt: no se encontró un TOTAL numérico")
  const fecha = normalizarFecha(primero(texto, /^\s*Fecha\s*:\s*(\S+)/im))
  const dias = primero(texto, /Validez[^:\n]*:\s*(\d+)\s*d[ií]as/i)
  return {
    numero: primero(texto, /^\s*COTIZACI[ÓO]N\s+(\S+)/im),
    proveedor: primero(texto, /^\s*Proveedor\s*:\s*(.+)$/im) ?? "",
    nit: normalizarNit(primero(texto, /^\s*NIT\s*:\s*(.+)$/im)),
    total: monto,
    moneda: total[1] ?? "COP",
    fecha,
    validez_hasta: fecha && dias ? sumarDias(fecha, Number(dias)) : null,
    texto,
  }
}

export function parsearFactura(texto: string): NonNullable<Paquete["factura"]> {
  const numero = primero(texto, /\bNo\.?\s*([A-Z0-9-]+)/i)
  const fecha = normalizarFecha(primero(texto, /Fecha de emisi[oó]n\s*:\s*(\S+)/i))
  const total = /^\s*TOTAL\b[^:\n]*:\s*(?:(?:COP|USD)\s*)?([\d.,]+)/im.exec(texto)
  const monto = total ? normalizarMonto(total[1]) : null
  if (!numero || !fecha || monto === null) {
    throw new Error("factura.txt: no se pudo leer número, fecha de emisión o total")
  }
  return { numero, fecha, total: monto }
}

/** HU-1: lee y normaliza el paquete. Adjuntos opcionales ausentes → null + `faltantes`. */
export async function leerPaquete(directory: string, caso: string): Promise<Resultado<Paquete>> {
  if (!casoValido(caso)) return fallo(`Nombre de caso inválido: "${caso}"`)
  const base = rutaCaso(directory, caso)
  const arch = (nombre: string): Archivo => ({ nombre, ruta: `${base}/${nombre}` })
  try {
    const [correoRaw, solicitudRaw, cotizTxt, aprobRaw, facturaTxt] = await Promise.all([
      leerJson(arch("correo.json")),
      leerJson(arch("solicitud.json")),
      leerTexto(arch("cotizacion.txt")),
      leerJson(arch("aprobacion.json")),
      leerTexto(arch("factura.txt")),
    ])
    const obligatorios = [
      correoRaw === null ? "correo.json" : null,
      solicitudRaw === null ? "solicitud.json" : null,
    ].filter((n): n is string => n !== null)
    if (obligatorios.length > 0) {
      return fallo(
        `Paquete incompleto para "${caso}": falta ${obligatorios.join(" y ")}. Pida al solicitante reenviar el paquete.`,
      )
    }
    const correo = CorreoSchema.safeParse(correoRaw)
    if (!correo.success) return fallo(`correo.json inválido: ${correo.error.issues.map((i) => i.message).join("; ")}`)
    const solicitud = SolicitudSchema.safeParse(solicitudRaw)
    if (!solicitud.success) {
      const det = solicitud.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      return fallo(`solicitud.json inválido (${det}). Pida al solicitante corregir la solicitud.`)
    }
    let aprobacion: Paquete["aprobacion"] = null
    if (aprobRaw !== null) {
      const a = AprobacionJsonSchema.safeParse(aprobRaw)
      if (!a.success) return fallo(`aprobacion.json inválido: ${a.error.issues.map((i) => i.message).join("; ")}`)
      aprobacion = {
        de: a.data.de.trim().toLowerCase(),
        para: a.data.para,
        cc: a.data.cc,
        asunto: a.data.asunto,
        fecha: a.data.fecha,
        aprobado: esAprobado(a.data.cuerpo),
        texto: a.data.cuerpo,
      }
    }
    const faltantes = [
      cotizTxt === null ? "cotizacion.txt" : null,
      aprobRaw === null ? "aprobacion.json" : null,
    ].filter((n): n is string => n !== null)
    return ok({
      correo: correo.data,
      solicitud: solicitud.data,
      cotizacion: cotizTxt === null ? null : parsearCotizacion(cotizTxt),
      aprobacion,
      factura: facturaTxt === null ? null : parsearFactura(facturaTxt),
      faltantes,
    })
  } catch (e) {
    return fallo(`No se pudo leer el paquete "${caso}": ${mensajeDeError(e)}`)
  }
}
