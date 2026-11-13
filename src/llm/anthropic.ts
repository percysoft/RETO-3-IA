import Anthropic from "@anthropic-ai/sdk"
import {
  ErrorLlm,
  type Bloque,
  type DefinicionHerramienta,
  type LlmAdapter,
  type MensajeLlm,
  type MotivoFin,
  type RespuestaLlm,
  type SolicitudLlm,
} from "./adapter.ts"

export const MODELO_POR_DEFECTO = "claude-opus-5-5"
const PROVEEDOR = "anthropic"

/** Quita la clave de cualquier texto que vaya a mostrarse o registrarse. */
export function redactar(texto: string, secreto: string | undefined): string {
  return secreto && secreto.length >= 8 ? texto.split(secreto).join("[REDACTADO]") : texto
}

// ---------- Conversión neutral → Anthropic ----------

export function aBloqueAnthropic(b: Bloque): Anthropic.ContentBlockParam | null {
  switch (b.tipo) {
    case "texto":
      return { type: "text", text: b.texto }
    case "uso_herramienta":
      return { type: "tool_use", id: b.id, name: b.nombre, input: b.entrada as Record<string, unknown> }
    case "resultado_herramienta":
      return { type: "tool_result", tool_use_id: b.id, content: b.contenido, is_error: b.esError }
    case "opaco":
      // Bloques propios del proveedor (razonamiento): se devuelven tal cual los recibimos.
      return b.proveedor === PROVEEDOR ? (b.datos as Anthropic.ContentBlockParam) : null
  }
}

export function aMensajesAnthropic(mensajes: MensajeLlm[]): Anthropic.MessageParam[] {
  return mensajes.map((m) => ({
    role: m.rol,
    content: m.bloques.map(aBloqueAnthropic).filter((b): b is Anthropic.ContentBlockParam => b !== null),
  }))
}

export function aHerramientasAnthropic(hs: DefinicionHerramienta[]): Anthropic.Tool[] {
  return hs.map((h) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: { type: "object", ...h.esquema } as Anthropic.Tool.InputSchema,
  }))
}

// ---------- Conversión Anthropic → neutral ----------

const MOTIVOS: Record<string, MotivoFin> = {
  end_turn: "fin",
  stop_sequence: "fin",
  tool_use: "herramientas",
  max_tokens: "limite_respuesta",
  refusal: "rechazo",
}

export function deRespuestaAnthropic(r: Anthropic.Message): RespuestaLlm {
  const bloques: Bloque[] = r.content.map((b): Bloque => {
    if (b.type === "text") return { tipo: "texto", texto: b.text }
    if (b.type === "tool_use") return { tipo: "uso_herramienta", id: b.id, nombre: b.name, entrada: b.input }
    return { tipo: "opaco", proveedor: PROVEEDOR, datos: b }
  })
  const u = r.usage
  const tokens =
    u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  return { bloques, motivo: MOTIVOS[r.stop_reason ?? ""] ?? "otro", tokens }
}

// ---------- Errores ----------

export function aErrorLlm(e: unknown, secreto: string | undefined): ErrorLlm {
  const limpio = (m: string) => redactar(m, secreto)
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new ErrorLlm("timeout", "El proveedor de IA tardó demasiado en responder (timeout).")
  }
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErrorLlm("autenticacion", "El proveedor de IA rechazó las credenciales configuradas en el servidor.")
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new ErrorLlm("limite_tasa", "El proveedor de IA está limitando las solicitudes; reintenta en unos segundos.")
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new ErrorLlm("red", "No se pudo conectar con el proveedor de IA.")
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new ErrorLlm("solicitud", limpio(`El proveedor de IA rechazó la solicitud: ${e.message}`))
  }
  if (e instanceof Anthropic.APIError) {
    return new ErrorLlm("proveedor", limpio(`Error del proveedor de IA (${e.status ?? "sin estado"}).`))
  }
  return new ErrorLlm("proveedor", limpio(`Error inesperado al llamar al proveedor de IA: ${e instanceof Error ? e.message : String(e)}`))
}

// ---------- Adaptador ----------

export type OpcionesAnthropic = { apiKey: string; modelo?: string; cliente?: Anthropic }

export class AnthropicAdapter implements LlmAdapter {
  readonly proveedor = PROVEEDOR
  readonly modelo: string
  private readonly cliente: Anthropic
  private readonly apiKey: string

  constructor(opciones: OpcionesAnthropic) {
    this.apiKey = opciones.apiKey
    this.modelo = opciones.modelo && opciones.modelo !== "" ? opciones.modelo : MODELO_POR_DEFECTO
    // Reintentos acotados: el tope de tiempo total lo gobierna el ciclo del agente.
    this.cliente = opciones.cliente ?? new Anthropic({ apiKey: opciones.apiKey, maxRetries: 1 })
  }

  /** Lee la clave SOLO del entorno del backend. Devuelve un `ErrorLlm` si no está configurada. */
  static desdeEntorno(env: Record<string, string | undefined> = process.env): AnthropicAdapter | ErrorLlm {
    const apiKey = env.LLM_API_KEY || env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return new ErrorLlm("autenticacion", "Falta la clave del proveedor de IA: defina LLM_API_KEY en el entorno del servidor.")
    }
    return new AnthropicAdapter({ apiKey, ...(env.LLM_MODEL ? { modelo: env.LLM_MODEL } : {}) })
  }

  async enviar(s: SolicitudLlm): Promise<RespuestaLlm> {
    try {
      const respuesta = await this.cliente.messages.create(
        {
          model: this.modelo,
          max_tokens: s.maxTokensRespuesta,
          // Prompt + conocimiento son estables: se cachean como prefijo.
          system: [{ type: "text", text: s.sistema, cache_control: { type: "ephemeral" } }],
          tools: aHerramientasAnthropic(s.herramientas),
          // "auto": el modelo decide cuándo llamar herramientas; nunca se fuerza una.
          tool_choice: { type: "auto" },
          messages: aMensajesAnthropic(s.mensajes),
        },
        { timeout: s.timeoutMs },
      )
      return deRespuestaAnthropic(respuesta)
    } catch (e) {
      throw aErrorLlm(e, this.apiKey)
    }
  }
}
