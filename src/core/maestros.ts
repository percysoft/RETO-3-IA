import { z } from "zod"
import {
  CentroCostoSchema,
  CondicionPagoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  type Maestros,
} from "./tipos.ts"
import { fallo, mensajeDeError, ok, type Resultado } from "./resultado.ts"
import { rutaFixtures } from "./rutas.ts"

async function leerLista<T extends z.ZodType>(ruta: string, schema: T): Promise<z.infer<T>[]> {
  const archivo = Bun.file(ruta)
  if (!(await archivo.exists())) throw new Error(`Falta el maestro ${ruta.split("/").pop()}`)
  const crudo: unknown = JSON.parse(await archivo.text())
  return z.array(schema).parse(crudo)
}

export async function cargarMaestros(directory: string): Promise<Resultado<Maestros>> {
  const dir = `${rutaFixtures(directory)}/maestros`
  try {
    const [proveedores, centrosCosto, indicadoresIva, condicionesPago] = await Promise.all([
      leerLista(`${dir}/proveedores.json`, ProveedorSchema),
      leerLista(`${dir}/centros-costo.json`, CentroCostoSchema),
      leerLista(`${dir}/indicadores-iva.json`, IndicadorIvaSchema),
      leerLista(`${dir}/condiciones-pago.json`, CondicionPagoSchema),
    ])
    return ok({ proveedores, centrosCosto, indicadoresIva, condicionesPago })
  } catch (e) {
    return fallo(`No se pudieron cargar los maestros: ${mensajeDeError(e)}`)
  }
}
