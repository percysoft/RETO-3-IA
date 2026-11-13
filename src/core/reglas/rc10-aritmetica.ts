import { cop, type Regla } from "./tipos.ts"

/** RC10 (bloqueo): cantidad × valor_unitario = valor_total (± 1 unidad monetaria). */
export const rc10Aritmetica: Regla = ({ paquete }) => {
  const { cantidad, valor_unitario, valor_total } = paquete.solicitud
  const calculado = cantidad * valor_unitario
  if (Math.abs(calculado - valor_total) <= 1) return {}
  return {
    bloqueos: [
      {
        codigo: "RC10",
        detalle: `${cop(cantidad)} × ${cop(valor_unitario)} = ${cop(calculado)}, pero el valor_total es ${cop(valor_total)}.`,
        accion_sugerida: "Pedir al solicitante corregir cantidad, valor unitario o valor total.",
      },
    ],
  }
}
