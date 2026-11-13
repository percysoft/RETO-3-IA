import { appendFile, mkdir } from "node:fs/promises"

/**
 * Eventos de auditoría de la confirmación humana. Los genera SOLO el backend (core y ciclo del
 * agente); ninguna herramienta ni argumento del modelo puede escribirlos. Se anexan a out/log.jsonl
 * con el campo `evento` en la raíz (las llamadas a herramientas usan `herramienta`).
 * No contienen secretos, documentos ni datos personales: solo identificadores y códigos RC.
 */
export type TipoEvento = "CONFIRMACION_SOLICITADA" | "CONFIRMACION_CONCEDIDA" | "CONFIRMACION_RECHAZADA"
export type EstadoEvento = "PENDIENTE" | "CONCEDIDA" | "RECHAZADA"

export type EventoAuditoria = {
  ts: string
  evento: TipoEvento
  caso: string
  solicitud_id: string
  sessionId: string
  huella: string
  estado: EstadoEvento
  confirmaciones: string[]
  origen: "backend"
  /** Solo en CONCEDIDA y RECHAZADA: identificador de la sesión que decidió (p. ej. "sesion:<id>"). */
  decidido_por?: string
}

let cola: Promise<unknown> = Promise.resolve()

/** Anexa una línea a out/log.jsonl con orden garantizado dentro del proceso. Nunca lanza. */
export function anexarLineaLog(outDir: string, linea: string): Promise<void> {
  const tarea = cola.then(async () => {
    await mkdir(outDir, { recursive: true })
    await appendFile(`${outDir}/log.jsonl`, `${linea}\n`)
  })
  cola = tarea.catch(() => undefined)
  return tarea.catch(() => undefined)
}

export function registrarEvento(outDir: string, e: EventoAuditoria): Promise<void> {
  return anexarLineaLog(outDir, JSON.stringify(e))
}
