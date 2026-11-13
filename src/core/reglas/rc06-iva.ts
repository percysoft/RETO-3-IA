import type { Regla } from "./tipos.ts"
import { proveedorMaestro } from "./proveedor-maestro.ts"

/** RC6: indicador de IVA ausente → se deriva del proveedor y se pide confirmación. Código desconocido → advertencia. */
export const rc6Iva: Regla = (entrada) => {
  const { indicador_iva } = entrada.paquete.solicitud
  const existe = (c: string) => entrada.maestros.indicadoresIva.some((i) => i.codigo === c)

  if (indicador_iva !== null) {
    const derivados = { indicador_iva: { codigo: indicador_iva, origen: "solicitud" as const } }
    if (existe(indicador_iva)) return { derivados }
    // Advertencia NO bloqueante: el PRD no define el código inexistente como regla de control.
    return {
      derivados,
      advertencias: [
        {
          codigo: "RC6",
          detalle: `El indicador de IVA "${indicador_iva}" no existe en el maestro de indicadores.`,
          accion_sugerida: "Verificar el indicador de IVA en la solicitud.",
        },
      ],
    }
  }
  const proveedor = proveedorMaestro(entrada)
  if (!proveedor) return {} // RC1 ya bloquea; no hay de dónde derivar.
  const codigo = proveedor.indicador_iva_default
  return {
    derivados: { indicador_iva: { codigo, origen: "derivado" } },
    confirmaciones: [
      {
        codigo: "RC6",
        detalle: `La solicitud no informa indicador de IVA; se derivó ${codigo} del proveedor ${proveedor.nombre.replace(/\.+$/, "")}.`,
        accion_sugerida: `Confirmar que el indicador ${codigo} es el correcto para esta compra.`,
      },
    ],
  }
}
