import { z } from "zod"
import { normalizarFecha, normalizarMonto, normalizarNit } from "./normalizar.ts"

// ---------- Esquemas de entrada (fixtures) ----------

const monto = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = normalizarMonto(v)
  if (n === null) {
    ctx.issues.push({ code: "custom", message: `monto no numérico: ${JSON.stringify(v)}`, input: v })
    return z.NEVER
  }
  return n
})

const fecha = z.string().transform((v, ctx) => {
  const f = normalizarFecha(v)
  if (f === null) {
    ctx.issues.push({ code: "custom", message: `fecha inválida: ${JSON.stringify(v)}`, input: v })
    return z.NEVER
  }
  return f
})

const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null))

export const CorreoSchema = z.object({
  id: z.string().min(1),
  de: z.string().min(1),
  asunto: z.string(),
  fecha: z.string().min(1),
})

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: textoOpcional.transform((v) => normalizarNit(v)),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: monto,
  valor_unitario: monto,
  valor_total: monto,
  moneda: z.enum(["COP", "USD"]),
  indicador_iva: textoOpcional,
  condiciones_pago: textoOpcional,
  fecha_solicitud: fecha,
})
export type Solicitud = z.infer<typeof SolicitudSchema>

export const AprobacionJsonSchema = z.object({
  de: z.string().min(1),
  para: z.string().min(1),
  cc: z.array(z.string()).default([]),
  fecha: z.string().min(1),
  asunto: z.string(),
  cuerpo: z.string(),
})

// ---------- Maestros ----------

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})
export type Proveedor = z.infer<typeof ProveedorSchema>

export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string(), tope: z.number() })),
})
export type CentroCosto = z.infer<typeof CentroCostoSchema>

export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() })
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() })

export type Maestros = {
  proveedores: Proveedor[]
  centrosCosto: CentroCosto[]
  indicadoresIva: z.infer<typeof IndicadorIvaSchema>[]
  condicionesPago: z.infer<typeof CondicionPagoSchema>[]
}

// ---------- Paquete normalizado (PRD 7.2, con campos extra aditivos) ----------

export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string }
  solicitud: Solicitud
  cotizacion: {
    numero: string | null
    proveedor: string
    nit: string | null
    total: number
    moneda: string
    fecha: string | null
    validez_hasta: string | null
    texto: string
  } | null
  aprobacion: {
    de: string
    para: string
    cc: string[]
    asunto: string
    fecha: string
    aprobado: boolean
    texto: string
  } | null
  factura: { numero: string; fecha: string; total: number } | null
  /** Nombres de archivos esperados que no existen (cotizacion.txt, aprobacion.json). */
  faltantes: string[]
}

// ---------- Hallazgos de validación ----------

export type CodigoRegla = "RC1" | "RC2" | "RC3" | "RC4" | "RC5" | "RC6" | "RC7" | "RC8" | "RC9" | "RC10"

export type Hallazgo = {
  codigo: CodigoRegla
  detalle: string
  accion_sugerida: string
}

export type OrigenValor = "solicitud" | "derivado"

export type Derivados = {
  proveedor: { codigo_sap: string; nit: string; nombre: string } | null
  aprobador: { email: string; nombre: string; tope: number } | null
  indicador_iva: { codigo: string; origen: OrigenValor } | null
  condiciones_pago: { codigo: string; origen: OrigenValor } | null
}

export type Validacion = {
  apta: boolean
  bloqueos: Hallazgo[]
  confirmaciones: Hallazgo[]
  advertencias: Hallazgo[]
  derivados: Derivados
  retroactiva: boolean
}

// ---------- Payload de la OC (PRD 7.4) ----------

export const OrdenCompraSchema = z.object({
  referencia: z.object({
    solicitud_id: z.string().min(1),
    correo_id: z.string().min(1),
    cotizacion_ref: z.string().nullable(),
  }),
  sociedad: z.literal("1000"),
  organizacion_compras: z.literal("1000"),
  proveedor: z.object({ codigo_sap: z.string().min(1), nit: z.string().min(1), nombre: z.string().min(1) }),
  moneda: z.enum(["COP", "USD"]),
  condiciones_pago: z.string().min(1),
  aprobador: z.object({
    email: z.string().min(1),
    fecha_aprobacion: z.string().min(1),
    evidencia_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().min(1).max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(["UN", "H", "MES"]),
        precio_unitario: z.number().nonnegative(),
        centro_costo: z.string().min(1),
        subarea: z.string().min(1),
        indicador_iva: z.string().min(1),
      }),
    )
    .min(1),
  excepciones: z.array(
    z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() }),
  ),
})
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>
