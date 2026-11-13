import { rc10Aritmetica } from "./rc10-aritmetica.ts"
import { rc1Proveedor } from "./rc01-proveedor.ts"
import { rc2Aprobacion } from "./rc02-aprobacion.ts"
import { rc3Tope } from "./rc03-tope.ts"
import { rc4Subarea } from "./rc04-subarea.ts"
import { rc5Cotizacion } from "./rc05-cotizacion.ts"
import { rc6Iva } from "./rc06-iva.ts"
import { rc7Pago } from "./rc07-pago.ts"
import { rc8Retroactiva } from "./rc08-retroactiva.ts"
import { rc9FechaAprobacion } from "./rc09-fecha-aprobacion.ts"
import type { Regla } from "./tipos.ts"

export type { EntradaRegla, Regla, SalidaRegla } from "./tipos.ts"

export {
  rc1Proveedor,
  rc2Aprobacion,
  rc3Tope,
  rc4Subarea,
  rc5Cotizacion,
  rc6Iva,
  rc7Pago,
  rc8Retroactiva,
  rc9FechaAprobacion,
  rc10Aritmetica,
}

/** Orden de ejecución = orden de reporte. */
export const REGLAS: readonly Regla[] = [
  rc1Proveedor,
  rc2Aprobacion,
  rc3Tope,
  rc4Subarea,
  rc5Cotizacion,
  rc6Iva,
  rc7Pago,
  rc8Retroactiva,
  rc9FechaAprobacion,
  rc10Aritmetica,
]
