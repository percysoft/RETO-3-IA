import { mismoTexto } from "../normalizar.ts"
import { centroDe, type Regla } from "./tipos.ts"

/** RC4 (bloqueo): la subárea pertenece al centro de costo. */
export const rc4Subarea: Regla = (entrada) => {
  const { centro_costo, subarea } = entrada.paquete.solicitud
  const centro = centroDe(entrada)
  if (!centro) {
    return {
      bloqueos: [
        {
          codigo: "RC4",
          detalle: `El centro de costo ${centro_costo} no existe en el maestro.`,
          accion_sugerida: "Corregir el centro de costo de la solicitud.",
        },
      ],
    }
  }
  if (centro.subareas.some((s) => mismoTexto(s, subarea))) return {}
  return {
    bloqueos: [
      {
        codigo: "RC4",
        detalle: `La subárea "${subarea}" no pertenece a ${centro.centro_costo}. Subáreas válidas: ${centro.subareas.join(", ")}.`,
        accion_sugerida: "Corregir la subárea o el centro de costo en la solicitud.",
      },
    ],
  }
}
