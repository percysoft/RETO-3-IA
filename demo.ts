/**
 * Demo determinística (PRD 6.6): procesa los 6 casos llamando a las herramientas, sin LLM ni claves.
 * Uso: bun run demo
 */
import { readdir, rm } from "node:fs/promises"
import type { ToolContext } from "./src/core/contexto.ts"
import { construir_payload, crear, validar } from "./src/tools/oc.ts"

const RAIZ = import.meta.dir
const OUT = `${RAIZ}/out`
const ANALISTA = "analista@periferia-ficticia.com"

type Json = Record<string, unknown>
type Hallazgo = { codigo: string; detalle: string; accion_sugerida: string }
type Respuesta = { ok: boolean; data?: Json; error?: string }

const llamar = async (s: Promise<string>): Promise<Respuesta> => JSON.parse(await s) as Respuesta

/** out/ se limpia al inicio (PRD §8); se conserva .gitkeep. */
async function limpiarOut(): Promise<void> {
  for (const nombre of await readdir(OUT)) if (nombre !== ".gitkeep") await rm(`${OUT}/${nombre}`, { recursive: true, force: true })
}

const titulo = (t: string) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`)
const lista = (rotulo: string, hs: Hallazgo[]) => {
  console.log(`  ${rotulo}:${hs.length === 0 ? " ninguno" : ""}`)
  for (const h of hs) console.log(`    - [${h.codigo}] ${h.detalle}\n        → ${h.accion_sugerida}`)
}

async function procesar(caso: string, etiqueta: string, confirmarHumano: boolean): Promise<void> {
  titulo(`${caso.toUpperCase()} · ${etiqueta}`)
  const base: ToolContext = { directory: RAIZ, sessionId: "demo" }

  const v = await llamar(validar.execute({ caso }, base))
  if (!v.ok || !v.data) return void console.log(`  ✗ Error: ${v.error}`)
  const d = v.data
  const bloqueos = d.bloqueos as Hallazgo[]
  const confirmaciones = d.confirmaciones as Hallazgo[]
  console.log(`  oc_validar → apta=${String(d.apta)}  retroactiva=${String(d.retroactiva)}`)
  lista("Bloqueos", bloqueos)
  lista("Confirmaciones", confirmaciones)
  const advertencias = (d.advertencias ?? []) as Hallazgo[]
  if (advertencias.length > 0) lista("Advertencias (no bloqueantes)", advertencias)
  const der = d.derivados as { indicador_iva: { codigo: string; origen: string } | null; condiciones_pago: { codigo: string; origen: string } | null }
  for (const [k, x] of Object.entries({ indicador_iva: der.indicador_iva, condiciones_pago: der.condiciones_pago })) {
    if (x?.origen === "derivado") console.log(`  Derivado: ${k} = ${x.codigo} (desde maestro de proveedores)`)
  }

  if (bloqueos.length > 0) {
    const r = await llamar(crear.execute({ caso }, base))
    return void console.log(`  oc_crear → ✗ NO se crea: ${r.error?.split(". ")[0]}.`)
  }

  if (confirmaciones.length > 0) {
    const p = await llamar(construir_payload.execute({ caso }, base))
    const orden = (p.data?.orden ?? {}) as { posiciones?: Json[]; proveedor?: Json }
    const pos = orden.posiciones?.[0] ?? {}
    console.log(`  Vista previa: ${String(orden.proveedor?.nombre)} · ${String(pos.cantidad)} ${String(pos.unidad)} × ${String(pos.precio_unitario)} · IVA ${String(pos.indicador_iva)}`)

    const pendiente = await llamar(crear.execute({ caso }, base))
    console.log(`  oc_crear (sin confirmación) → ✗ ${pendiente.error?.split(". ")[0]}. OC NO creada.`)
    if (!confirmarHumano) return
    console.log(`  [humano simulado: "${ANALISTA}" responde "confirmo"]`)
    const c = await llamar(crear.execute({ caso, confirmado: true }, { ...base, confirmacionHumana: { por: ANALISTA } }))
    return void imprimirCreacion(c)
  }

  imprimirCreacion(await llamar(crear.execute({ caso }, base)))
}

function imprimirCreacion(r: Respuesta): void {
  if (!r.ok || !r.data) return void console.log(`  oc_crear → ✗ ${r.error}`)
  const nota = r.data.idempotente === true ? " (idempotente: ya existía, no se creó otra)" : ""
  console.log(`  oc_crear → ✓ OC ${String(r.data.numero_oc)}${nota}`)
}

await limpiarOut()
console.log("DEMO RETO 03 — órdenes de compra SAP (sin LLM)")

await procesar("sol-001", "flujo normal: se crea sola", false)
await procesar("sol-002", "proveedor inexistente → bloqueo RC1", false)
await procesar("sol-003", "aprobador sin autoridad → bloqueo RC2", false)
await procesar("sol-004", "cotización ≠ solicitud → confirmación humana", true)
await procesar("sol-005", "factura anterior a la solicitud → retroactiva", true)
await procesar("sol-006", "IVA no informado → derivado + confirmación", true)
await procesar("sol-001", "IDEMPOTENCIA: segunda ejecución del caso 001", false)

titulo("RESUMEN · out/control.csv")
console.log(await Bun.file(`${OUT}/control.csv`).text())
titulo("RESUMEN · out/sap/ordenes.jsonl")
for (const l of (await Bun.file(`${OUT}/sap/ordenes.jsonl`).text()).trim().split("\n")) {
  const r = JSON.parse(l) as { numero_oc: string; orden: { referencia: { solicitud_id: string }; excepciones: { codigo: string; confirmado_por: string | null }[] } }
  const ex = r.orden.excepciones.map((e) => `${e.codigo}✓${e.confirmado_por}`).join(", ")
  console.log(`  ${r.numero_oc}  ${r.orden.referencia.solicitud_id}  excepciones: ${ex || "—"}`)
}
