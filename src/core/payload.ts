import { mkdir } from "node:fs/promises"
import { OrdenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Validacion } from "./tipos.ts"
import { fallo, ok, type Resultado } from "./resultado.ts"

export type Fuente =
  | "solicitud"
  | "cotizacion"
  | "correo"
  | "aprobacion"
  | "evidencia"
  | "constante"
  | "derivado"
  | `maestro.${"proveedores" | "centros-costo" | "indicadores-iva" | "condiciones-pago"}`

export type Traza = { valor: string | number | null; fuente: Fuente; nota?: string }
export type Trazabilidad = Record<string, Traza>

const MAX_DESCRIPCION = 40

/**
 * Unidad de medida derivada del texto; "UN" por defecto. Siempre se registra como `derivado`.
 *
 * LIMITACIÓN: los fixtures y el PRD no traen la unidad; esto es una heurística por palabras clave.
 *  - "hora(s)" en la descripción o la cotización → "H" (falla si "horas" aparece en otro contexto,
 *    p. ej. "horario de soporte 24 horas" en un bien físico).
 *  - "mensual"/"por mes" → "MES" (no detecta otras formulaciones, p. ej. "cada mes", "x mes").
 *  - Todo lo demás → "UN", incluso servicios por día o por proyecto.
 * En producción la unidad debe venir de la solicitud (campo explícito) y esta inferencia
 * debería retirarse o pasar a confirmación.
 */
export function derivarUnidad(paquete: Paquete): "UN" | "H" | "MES" {
  const texto = `${paquete.solicitud.descripcion} ${paquete.cotizacion?.texto ?? ""}`.toLowerCase()
  if (/\bhoras?\b/.test(texto)) return "H"
  if (/\bpor mes\b|\bmensual(es)?\b/.test(texto)) return "MES"
  return "UN"
}

export type EntradaPayload = {
  paquete: Paquete
  maestros: Maestros
  validacion: Validacion
  evidenciaSha256: string
  /** Quién confirmó las excepciones; null mientras estén pendientes (vista previa). */
  confirmadoPor: string | null
}

/**
 * HU-3: construye el payload SOLO desde el paquete y los maestros leídos por el backend.
 * Los montos provienen de la solicitud (nunca de la cotización ni del modelo).
 */
export function construirPayload(e: EntradaPayload): Resultado<{ orden: OrdenCompra; trazabilidad: Trazabilidad }> {
  const { paquete, validacion } = e
  const { solicitud, aprobacion } = paquete
  const { proveedor, indicador_iva, condiciones_pago } = validacion.derivados
  if (!validacion.apta) return fallo("La solicitud tiene bloqueos; no se construye el payload.")
  if (!proveedor || !indicador_iva || !condiciones_pago || !aprobacion) {
    return fallo("Faltan datos derivados (proveedor, IVA, condiciones de pago o aprobación) para construir el payload.")
  }

  const t: Trazabilidad = {}
  const reg = <V extends string | number | null>(campo: string, valor: V, fuente: Fuente, nota?: string): V => {
    t[campo] = nota === undefined ? { valor, fuente } : { valor, fuente, nota }
    return valor
  }
  const origen = (o: "solicitud" | "derivado", maestro: Fuente): Fuente => (o === "solicitud" ? "solicitud" : maestro)

  const descripcion = solicitud.descripcion.slice(0, MAX_DESCRIPCION).trimEnd()
  const unidad = derivarUnidad(paquete)
  const p = "posiciones.0"

  const candidato: OrdenCompra = {
    referencia: {
      solicitud_id: reg("referencia.solicitud_id", solicitud.solicitud_id, "solicitud"),
      correo_id: reg("referencia.correo_id", paquete.correo.id, "correo"),
      cotizacion_ref: reg("referencia.cotizacion_ref", paquete.cotizacion?.numero ?? null, "cotizacion"),
    },
    sociedad: reg("sociedad", "1000" as const, "constante"),
    organizacion_compras: reg("organizacion_compras", "1000" as const, "constante"),
    proveedor: {
      codigo_sap: reg("proveedor.codigo_sap", proveedor.codigo_sap, "maestro.proveedores"),
      nit: reg("proveedor.nit", proveedor.nit, "maestro.proveedores"),
      nombre: reg("proveedor.nombre", proveedor.nombre, "maestro.proveedores"),
    },
    moneda: reg("moneda", solicitud.moneda, "solicitud"),
    condiciones_pago: reg(
      "condiciones_pago",
      condiciones_pago.codigo,
      origen(condiciones_pago.origen, "maestro.proveedores"),
      condiciones_pago.origen === "derivado" ? "Derivada de condiciones_pago_default del proveedor (RC7)" : undefined,
    ),
    aprobador: {
      email: reg("aprobador.email", aprobacion.de, "aprobacion"),
      fecha_aprobacion: reg("aprobador.fecha_aprobacion", aprobacion.fecha, "aprobacion"),
      evidencia_sha256: reg("aprobador.evidencia_sha256", e.evidenciaSha256, "evidencia"),
    },
    posiciones: [
      {
        numero: reg(`${p}.numero`, 10, "constante"),
        descripcion: reg(
          `${p}.descripcion`,
          descripcion,
          descripcion === solicitud.descripcion ? "solicitud" : "derivado",
          descripcion === solicitud.descripcion ? undefined : `Truncada a ${MAX_DESCRIPCION} caracteres (límite SAP)`,
        ),
        cantidad: reg(`${p}.cantidad`, solicitud.cantidad, "solicitud"),
        unidad: reg(`${p}.unidad`, unidad, "derivado", "Inferida del texto de la solicitud/cotización; UN por defecto"),
        precio_unitario: reg(`${p}.precio_unitario`, solicitud.valor_unitario, "solicitud"),
        centro_costo: reg(`${p}.centro_costo`, solicitud.centro_costo, "solicitud"),
        subarea: reg(`${p}.subarea`, solicitud.subarea, "solicitud"),
        indicador_iva: reg(
          `${p}.indicador_iva`,
          indicador_iva.codigo,
          origen(indicador_iva.origen, "maestro.proveedores"),
          indicador_iva.origen === "derivado" ? "Derivado de indicador_iva_default del proveedor (RC6)" : undefined,
        ),
      },
    ],
    excepciones: validacion.confirmaciones.map((c, i) => {
      reg(`excepciones.${i}`, `${c.codigo}: ${c.detalle}`, "derivado")
      return { codigo: c.codigo, detalle: c.detalle, confirmado_por: e.confirmadoPor }
    }),
  }

  const parsed = OrdenCompraSchema.safeParse(candidato)
  if (!parsed.success) {
    const det = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return fallo(`El payload no cumple el esquema de la OC: ${det}`)
  }
  return ok({ orden: parsed.data, trazabilidad: t })
}

/** Guarda out/<caso>/trazabilidad.json y devuelve su ruta relativa. */
export async function guardarTrazabilidad(outDir: string, caso: string, t: Trazabilidad): Promise<string> {
  await mkdir(`${outDir}/${caso}`, { recursive: true })
  await Bun.write(`${outDir}/${caso}/trazabilidad.json`, `${JSON.stringify(t, null, 2)}\n`)
  return `out/${caso}/trazabilidad.json`
}
