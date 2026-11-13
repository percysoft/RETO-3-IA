import { z } from "zod"

/** Entero positivo en texto plano (sin signo, decimales, espacios ni vacío). Ausente → 30. */
const LimitePorMinuto = z
  .string()
  .regex(/^[1-9]\d*$/, "debe ser un entero positivo (ej. 30)")
  .transform(Number)
  .pipe(z.number().safe())
  .default(30)

/** Entero positivo opcional en texto plano. Ausente → undefined (sin límite). */
const EnteroPositivoOpcional = z
  .string()
  .regex(/^[1-9]\d*$/, "debe ser un entero positivo")
  .transform(Number)
  .pipe(z.number().safe())
  .optional()

/** Booleano explícito: solo "true" o "false". Ausente → false. Cualquier otra cosa se rechaza. */
const Booleano = z
  .enum(["true", "false"], { error: 'debe ser "true" o "false"' })
  .transform((v) => v === "true")
  .default(false)

export const ACCESS_KEY_MIN = 16

const EntornoSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** Interfaz de escucha. Vacío se rechaza (como el resto de variables numéricas). */
  HOST: z.string().trim().min(1, "no puede estar vacío").default("127.0.0.1"),
  NODE_ENV: z.string().default(""),
  MAX_ITERACIONES: z.coerce.number().int().positive().default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().positive().default(100_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_PROVIDER: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  RATE_LIMIT_CHAT_PER_MIN: LimitePorMinuto,
  /** Clave de acceso compartida para /api/chat y /api/sessions/:id. Obligatoria en producción. */
  ACCESS_KEY: z.string().optional(),
  /**
   * Permite NODE_ENV=production SIN clave de acceso (demo pública). Es una decisión explícita: cualquiera con
   * el enlace puede usar la clave de IA, acotado solo por los límites (frecuencia y presupuesto global).
   * No puede combinarse con ACCESS_KEY.
   */
  ALLOW_OPEN_ACCESS: Booleano,
  /** Confiar en una cabecera de proxy para la IP del cliente. Desactivado por defecto. */
  TRUST_PROXY: Booleano,
  /** Cabecera que lleva la cadena de IPs (solo se usa con TRUST_PROXY=true). */
  TRUST_PROXY_HEADER: z.string().trim().toLowerCase().min(1).default("x-forwarded-for"),
  /** Saltos de proxy de confianza, contados desde la derecha de la cadena. */
  TRUST_PROXY_HOPS: z
    .string()
    .regex(/^[1-9]\d?$/, "debe ser un entero entre 1 y 99")
    .transform(Number)
    .default(1),
  /** Tope global de tokens del proceso (suma de todas las sesiones). Ausente → sin tope. */
  GLOBAL_TOKEN_BUDGET: EnteroPositivoOpcional,
  /** Informa en /api/health y en la UI que el almacenamiento es efímero (p. ej. Render Free). */
  EPHEMERAL_STORAGE: Booleano,
})

type Bruta = z.infer<typeof EntornoSchema>
export type Config = Omit<Bruta, "ACCESS_KEY"> & { ACCESS_KEY: string | undefined }

/**
 * Lee la configuración no secreta. La clave del LLM se lee solo en el adaptador, nunca aquí.
 * ACCESS_KEY: en producción (NODE_ENV=production) es obligatoria y de ≥ 16 caracteres, salvo que se active
 * explícitamente ALLOW_OPEN_ACCESS=true (demo pública sin clave). Fuera de producción puede omitirse (o dejarse
 * vacía) y entonces el acceso queda abierto. Si se informa, debe cumplir el mínimo y no puede combinarse con
 * ALLOW_OPEN_ACCESS. Los mensajes de error nunca incluyen el valor.
 */
export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const base = EntornoSchema.parse(env)
  const clave = (base.ACCESS_KEY ?? "").trim()
  const produccion = base.NODE_ENV === "production"
  if (base.ALLOW_OPEN_ACCESS && clave !== "") {
    throw new Error("ALLOW_OPEN_ACCESS=true no puede combinarse con ACCESS_KEY: defina solo una de las dos.")
  }
  if (produccion && clave === "" && !base.ALLOW_OPEN_ACCESS) {
    throw new Error(`ACCESS_KEY es obligatoria en producción (NODE_ENV=production) y debe tener al menos ${ACCESS_KEY_MIN} caracteres (o active ALLOW_OPEN_ACCESS=true para una demo pública sin clave).`)
  }
  if (clave !== "" && clave.length < ACCESS_KEY_MIN) {
    throw new Error(`ACCESS_KEY debe tener al menos ${ACCESS_KEY_MIN} caracteres.`)
  }
  return { ...base, ACCESS_KEY: clave === "" ? undefined : clave }
}
