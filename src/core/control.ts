import { appendFile, mkdir } from "node:fs/promises"

export type ResultadoIntento = "CREADA" | "IDEMPOTENTE" | "BLOQUEADA" | "PENDIENTE_CONFIRMACION" | "RECHAZADA" | "ERROR"

export type FilaControl = {
  solicitud_id: string
  resultado: ResultadoIntento
  numero_oc: string | null
  retroactiva: boolean
  bloqueos: string[]
  confirmaciones: string[]
  ts: string
}

export const ENCABEZADO_CONTROL = "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts"

function celda(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function filaCsv(f: FilaControl): string {
  return [
    f.solicitud_id,
    f.resultado,
    f.numero_oc ?? "",
    String(f.retroactiva),
    f.bloqueos.join(";"),
    f.confirmaciones.join(";"),
    f.ts,
  ]
    .map(celda)
    .join(",")
}

let cola: Promise<unknown> = Promise.resolve()

/** Agrega un intento a out/control.csv (HU-5). Nunca lanza: el control no debe tumbar el flujo. */
export function registrarIntento(outDir: string, fila: FilaControl): Promise<void> {
  const tarea = cola.then(async () => {
    await mkdir(outDir, { recursive: true })
    const ruta = `${outDir}/control.csv`
    const existe = await Bun.file(ruta).exists()
    await appendFile(ruta, `${existe ? "" : `${ENCABEZADO_CONTROL}\n`}${filaCsv(fila)}\n`)
  })
  cola = tarea.catch(() => undefined)
  return tarea.catch(() => undefined)
}
