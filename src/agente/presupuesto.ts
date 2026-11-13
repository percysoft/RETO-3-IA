/**
 * Presupuesto global de tokens del proceso (suma de TODAS las sesiones), con reserva previa para que
 * llamadas concurrentes no lo superen. JavaScript es monohilo: `reservar` no tiene ningún `await`
 * entre comprobar y reservar, así que es atómica; cada reserva se liquida siempre (con los tokens
 * reales, o con 0 si la llamada falló). El sobreconsumo posible queda acotado a la diferencia entre
 * el consumo real y la reserva de las llamadas en curso. Vive en memoria: se reinicia con el proceso.
 */
export type EstadoPresupuesto = { limite: number; consumido: number; reservado: number; disponible: number }

export class PresupuestoGlobal {
  private consumido = 0
  private reservado = 0

  /**
   * @param limite tokens totales permitidos desde el arranque.
   * @param reservaPorLlamada tokens que se reservan antes de cada llamada al modelo (aprox. al peso de
   *   una llamada típica; con el historial creciendo una llamada puede pesar más, de ahí el margen).
   */
  constructor(
    readonly limite: number,
    readonly reservaPorLlamada = 16_000,
  ) {
    if (!Number.isSafeInteger(limite) || limite <= 0) throw new Error("El presupuesto debe ser un entero positivo.")
    if (!Number.isSafeInteger(reservaPorLlamada) || reservaPorLlamada <= 0) throw new Error("La reserva debe ser un entero positivo.")
  }

  /** Reserva atómica. Devuelve los tokens reservados, o null si no cabe dentro del presupuesto. */
  reservar(): number | null {
    if (this.consumido + this.reservado + this.reservaPorLlamada > this.limite) return null
    this.reservado += this.reservaPorLlamada
    return this.reservaPorLlamada
  }

  /** Cierra una reserva: libera lo reservado y suma el consumo real (0 si la llamada falló). */
  liquidar(reserva: number, real: number): void {
    this.reservado = Math.max(0, this.reservado - reserva)
    this.consumido += Number.isFinite(real) && real > 0 ? Math.round(real) : 0
  }

  get estado(): EstadoPresupuesto {
    return {
      limite: this.limite,
      consumido: this.consumido,
      reservado: this.reservado,
      disponible: Math.max(0, this.limite - this.consumido - this.reservado),
    }
  }
}
