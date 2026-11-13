import { z } from "zod"
import { resolverContexto, type ToolContext } from "../core/contexto.ts"
import { leerPaquete } from "../core/paquete.ts"
import { capturar, type Resultado } from "../core/resultado.ts"
import { crearOc, evidenciaCaso, payloadCaso, validarCaso } from "../core/servicio.ts"

export type { ToolContext } from "../core/contexto.ts"

/** Serializa el resultado; cualquier excepción se convierte en { ok:false, error } (PRD 6.2). */
async function responder<T>(ctx: ToolContext, fn: (c: ReturnType<typeof resolverContexto>) => Promise<Resultado<T>>) {
  const r = await capturar(async () => fn(resolverContexto(ctx)))
  return JSON.stringify(r)
}

const caso = z.string().describe("Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/ (ej. sol-001)")
const ignorado = (que: string) =>
  z.unknown().optional().describe(`Ignorado: el backend relee ${que} desde disco; no se confía en valores del modelo.`)

export const leer_paquete = {
  description: "Lee y normaliza el paquete del caso (correo, solicitud, cotización, aprobación y factura si existe).",
  args: { caso },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return responder(ctx, (c) => leerPaquete(c.directory, args.caso))
  },
}

export const validar = {
  description: "Valida el caso contra los maestros y reglas RC1–RC10: devuelve apta, bloqueos, confirmaciones, derivados y retroactiva.",
  args: { caso, paquete: ignorado("el paquete") },
  async execute(args: { caso: string; paquete?: unknown }, ctx: ToolContext): Promise<string> {
    return responder(ctx, (c) => validarCaso(c, args.caso))
  },
}

export const generar_evidencia = {
  description: "Genera la evidencia de aprobación (TXT con SHA-256) del caso en out/<caso>/aprobacion.txt.",
  args: { caso },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    return responder(ctx, (c) => evidenciaCaso(c, args.caso))
  },
}

export const construir_payload = {
  description: "Construye la OC tal como quedaría en SAP (con evidencia y trazabilidad por campo); falla si hay bloqueos.",
  args: { caso, paquete: ignorado("el paquete"), derivados: ignorado("los derivados") },
  async execute(args: { caso: string; paquete?: unknown; derivados?: unknown }, ctx: ToolContext): Promise<string> {
    return responder(ctx, (c) => payloadCaso(c, args.caso))
  },
}

export const crear = {
  description:
    "Crea la OC en SAP simulado si no hay bloqueos; con confirmaciones pendientes solo procede si el usuario ya las confirmó.",
  args: {
    caso,
    payload: ignorado("el payload (solo se contrasta con el validado por el backend)"),
    confirmado: z.boolean().optional().describe("true solo si el usuario confirmó explícitamente las excepciones mostradas."),
  },
  async execute(args: { caso: string; payload?: unknown; confirmado?: boolean }, ctx: ToolContext): Promise<string> {
    return responder(ctx, (c) => crearOc(c, args))
  },
}

