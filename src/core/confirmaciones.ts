import { mkdir } from "node:fs/promises"
import { z } from "zod"
import { sha256 } from "./evidencia.ts"
import type { Paquete, Validacion } from "./tipos.ts"

/** Estado por solicitud_id. Los campos opcionales guardan el ciclo de la confirmación (auditoría). */
const EntradaSchema = z.object({
  huella: z.string(),
  ts: z.string(),
  solicitada: z.string().optional(),
  concedida: z.string().optional(),
  rechazada: z.string().optional(),
  numero_oc: z.string().optional(),
})
const EstadoSchema = z.record(z.string(), EntradaSchema)

/**
 * Huella de lo que se le mostró al humano: solicitud, valores y textos de las confirmaciones.
 * Si cambia cualquier dato, la confirmación previa deja de valer.
 */
export function huellaConfirmaciones(paquete: Paquete, validacion: Validacion): string {
  const { solicitud } = paquete
  return sha256(
    JSON.stringify({
      id: solicitud.solicitud_id,
      total: solicitud.valor_total,
      conf: validacion.confirmaciones.map((c) => `${c.codigo}|${c.detalle}`),
    }),
  )
}

async function leerEstado(outDir: string): Promise<z.infer<typeof EstadoSchema>> {
  const f = Bun.file(`${outDir}/confirmaciones.json`)
  if (!(await f.exists())) return {}
  const r = EstadoSchema.safeParse(JSON.parse(await f.text()) as unknown)
  return r.success ? r.data : {}
}

/** Deja constancia de que las confirmaciones se presentaron al humano (estado del backend). */
export async function registrarPendiente(outDir: string, solicitudId: string, huella: string, ts: string) {
  const estado = await leerEstado(outDir)
  if (estado[solicitudId]?.huella === huella) return
  await mkdir(outDir, { recursive: true })
  await Bun.write(
    `${outDir}/confirmaciones.json`,
    `${JSON.stringify({ ...estado, [solicitudId]: { huella, ts } }, null, 2)}\n`,
  )
}

export async function estaPendientePresentada(outDir: string, solicitudId: string, huella: string): Promise<boolean> {
  return (await leerEstado(outDir))[solicitudId]?.huella === huella
}

export type CampoCiclo = "solicitada" | "concedida" | "rechazada" | "numero_oc"

/**
 * Marca una etapa del ciclo para la huella vigente. Devuelve true si se escribió (la etapa estaba
 * ausente) y false si ya constaba o si la huella no es la vigente: sirve para no duplicar filas/eventos.
 * Una nueva solicitud limpia concesión/rechazo previos; un rechazo limpia la solicitud (permite pedir de nuevo).
 */
export async function marcarEtapa(
  outDir: string,
  solicitudId: string,
  huella: string,
  campo: CampoCiclo,
  valor: string,
): Promise<boolean> {
  const estado = await leerEstado(outDir)
  const entrada = estado[solicitudId]
  if (!entrada || entrada.huella !== huella || entrada[campo] !== undefined) return false
  const siguiente = { ...entrada, [campo]: valor }
  if (campo === "solicitada") {
    delete siguiente.rechazada
    delete siguiente.concedida
  }
  if (campo === "rechazada") delete siguiente.solicitada
  await Bun.write(`${outDir}/confirmaciones.json`, `${JSON.stringify({ ...estado, [solicitudId]: siguiente }, null, 2)}\n`)
  return true
}
