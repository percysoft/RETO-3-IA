/**
 * Interfaz propia del proveedor LLM (PRD 6.1). El ciclo del agente solo conoce estos tipos;
 * cambiar de proveedor implica escribir otro adaptador, no tocar el ciclo.
 */

export type BloqueTexto = { tipo: "texto"; texto: string }
export type BloqueUsoHerramienta = { tipo: "uso_herramienta"; id: string; nombre: string; entrada: unknown }
export type BloqueResultadoHerramienta = { tipo: "resultado_herramienta"; id: string; contenido: string; esError: boolean }
/** Bloque propio del proveedor (p. ej. razonamiento) que debe reenviarse intacto en el historial. */
export type BloqueOpaco = { tipo: "opaco"; proveedor: string; datos: unknown }

export type Bloque = BloqueTexto | BloqueUsoHerramienta | BloqueResultadoHerramienta | BloqueOpaco

export type MensajeLlm = { rol: "user" | "assistant"; bloques: Bloque[] }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  /** JSON Schema (objeto) de los argumentos. */
  esquema: Record<string, unknown>
}

export type SolicitudLlm = {
  sistema: string
  mensajes: MensajeLlm[]
  herramientas: DefinicionHerramienta[]
  maxTokensRespuesta: number
  timeoutMs: number
}

export type MotivoFin = "fin" | "herramientas" | "limite_respuesta" | "rechazo" | "otro"

export type RespuestaLlm = {
  bloques: Bloque[]
  motivo: MotivoFin
  /** Tokens consumidos por esta llamada (entrada + salida, incluida la caché). */
  tokens: number
}

export type TipoErrorLlm = "timeout" | "autenticacion" | "limite_tasa" | "red" | "solicitud" | "proveedor"

/** Error legible del proveedor; el mensaje nunca contiene secretos. */
export class ErrorLlm extends Error {
  constructor(
    readonly tipo: TipoErrorLlm,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = "ErrorLlm"
  }
}

export interface LlmAdapter {
  readonly proveedor: string
  readonly modelo: string
  /** Lanza `ErrorLlm` ante cualquier fallo del proveedor. */
  enviar(solicitud: SolicitudLlm): Promise<RespuestaLlm>
}
