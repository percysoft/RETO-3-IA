import { anexarLineaLog } from "../core/auditoria.ts"
import { redactar } from "../llm/anthropic.ts"

export type EntradaLog = {
  ts: string
  sessionId: string
  herramienta: string
  args: unknown
  ok: boolean
  resumen: string
  ms: number
}

const MAX_RESUMEN = 500

/** Registra una llamada a herramienta en out/log.jsonl (CA4). Nunca lanza ni guarda secretos. */
export function registrarLlamada(outDir: string, e: EntradaLog, secreto?: string): Promise<void> {
  const linea = redactar(JSON.stringify({ ...e, resumen: e.resumen.slice(0, MAX_RESUMEN) }), secreto)
  return anexarLineaLog(outDir, linea)
}
