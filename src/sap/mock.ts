import { appendFile, mkdir } from "node:fs/promises"
import { normalizarNit } from "../core/normalizar.ts"
import { rutaFixtures } from "../core/rutas.ts"
import { ProveedorSchema, type OrdenCompra } from "../core/tipos.ts"
import { z } from "zod"
import type { SapAdapter } from "./adapter.ts"

export const PRIMER_NUMERO_OC = 4500000001

const RegistroSchema = z.object({
  numero_oc: z.string(),
  fecha: z.string(),
  orden: z.object({ referencia: z.object({ solicitud_id: z.string() }) }).loose(),
})
type Registro = z.infer<typeof RegistroSchema>

/** Serializa operaciones de escritura del proceso para que la numeración no se duplique. */
let cola: Promise<unknown> = Promise.resolve()
function enSerie<T>(fn: () => Promise<T>): Promise<T> {
  const siguiente = cola.then(fn, fn)
  cola = siguiente.catch(() => undefined)
  return siguiente
}

export type OpcionesMock = { directory: string; outDir: string; ahora?: () => Date }

/** SAP simulado sobre archivos: out/sap/ordenes.jsonl (una línea por OC). */
export class MockSapAdapter implements SapAdapter {
  private readonly archivo: string
  private readonly ahora: () => Date

  constructor(private readonly opciones: OpcionesMock) {
    this.archivo = `${opciones.outDir}/sap/ordenes.jsonl`
    this.ahora = opciones.ahora ?? (() => new Date())
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const f = Bun.file(`${rutaFixtures(this.opciones.directory)}/maestros/proveedores.json`)
    const lista = z.array(ProveedorSchema).parse(JSON.parse(await f.text()) as unknown)
    const buscado = normalizarNit(nit)
    const p = lista.find((x) => normalizarNit(x.nit) === buscado)
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha?: string } | null> {
    const r = (await this.leerRegistros()).find((x) => x.orden.referencia.solicitud_id === solicitud_id)
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null
  }

  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    return enSerie(async () => {
      const registros = await this.leerRegistros()
      // Defensa ante carreras entre procesos: la referencia es única.
      const previo = registros.find((x) => x.orden.referencia.solicitud_id === orden.referencia.solicitud_id)
      if (previo) return { numero_oc: previo.numero_oc, fecha: previo.fecha }

      const maximo = registros.reduce((m, r) => Math.max(m, Number(r.numero_oc)), PRIMER_NUMERO_OC - 1)
      const registro: Registro = { numero_oc: String(maximo + 1), fecha: this.ahora().toISOString(), orden }
      await mkdir(`${this.opciones.outDir}/sap`, { recursive: true })
      await appendFile(this.archivo, `${JSON.stringify(registro)}\n`)
      return { numero_oc: registro.numero_oc, fecha: registro.fecha }
    })
  }

  private async leerRegistros(): Promise<Registro[]> {
    const f = Bun.file(this.archivo)
    if (!(await f.exists())) return []
    return (await f.text())
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => RegistroSchema.parse(JSON.parse(l) as unknown))
  }
}
