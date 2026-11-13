/** Resultado tipado que nunca lanza hacia el consumidor (HU-6). */
export type Fallo = { ok: false; error: string }
export type Exito<T> = { ok: true; data: T }
export type Resultado<T> = Exito<T> | Fallo

export const ok = <T>(data: T): Exito<T> => ({ ok: true, data })
export const fallo = (error: string): Fallo => ({ ok: false, error })

export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Ejecuta `fn` y convierte cualquier excepción en `{ ok: false, error }`. */
export async function capturar<T>(fn: () => Promise<Resultado<T>>): Promise<Resultado<T>> {
  try {
    return await fn()
  } catch (e) {
    return fallo(`Error inesperado: ${mensajeDeError(e)}`)
  }
}
