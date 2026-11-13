import { describe, expect, test } from "bun:test"
import {
  rc10Aritmetica, rc1Proveedor, rc2Aprobacion, rc3Tope, rc4Subarea, rc5Cotizacion,
  rc6Iva, rc7Pago, rc8Retroactiva, rc9FechaAprobacion,
} from "../src/core/reglas/index.ts"
import type { Paquete } from "../src/core/tipos.ts"
import { conSolicitud, maestros, paquete } from "./ayudas.ts"

const m = await maestros()
const base = await paquete("sol-001")
const e = (p: Paquete) => ({ paquete: p, maestros: m })

describe("RC1 proveedor", () => {
  test("existe y activo", () => expect(rc1Proveedor(e(base)).bloqueos ?? []).toHaveLength(0))
  test("NIT inexistente → bloqueo", () =>
    expect(rc1Proveedor(e(conSolicitud(base, { proveedor_nit: "901999000" }))).bloqueos?.[0]?.codigo).toBe("RC1"))
  test("sin NIT → por nombre normalizado", () => {
    const p = conSolicitud(base, { proveedor_nit: null, proveedor_nombre: "tecnosuministros sas" })
    expect(rc1Proveedor(e(p)).derivados?.proveedor?.codigo_sap).toBe("100234")
  })
  test("sin NIT y nombre desconocido → bloqueo", () =>
    expect(rc1Proveedor(e(conSolicitud(base, { proveedor_nit: null, proveedor_nombre: "Nadie" }))).bloqueos).toHaveLength(1))
  test("proveedor inactivo → bloqueo", () =>
    expect(rc1Proveedor(e(conSolicitud(base, { proveedor_nit: "901777888" }))).bloqueos?.[0]?.detalle).toContain("inactivo"))
})

describe("RC2 aprobación", () => {
  test("válida", () => expect(rc2Aprobacion(e(base)).bloqueos ?? []).toHaveLength(0))
  test("ausente", () => expect(rc2Aprobacion(e({ ...base, aprobacion: null })).bloqueos).toHaveLength(1))
  test("sin la palabra Aprobado", () => {
    const a = base.aprobacion
    if (!a) throw new Error("fixture")
    expect(rc2Aprobacion(e({ ...base, aprobacion: { ...a, aprobado: false } })).bloqueos).toHaveLength(1)
  })
  test("aprobador no listado en el centro", () => {
    const a = base.aprobacion
    if (!a) throw new Error("fixture")
    expect(rc2Aprobacion(e({ ...base, aprobacion: { ...a, de: "rtorres@periferia-ficticia.com" } })).bloqueos).toHaveLength(1)
  })
})

describe("RC3 tope", () => {
  test("dentro del tope", () => expect(rc3Tope(e(base)).bloqueos ?? []).toHaveLength(0))
  test("excede el tope (50M de mlopez)", () =>
    expect(rc3Tope(e(conSolicitud(base, { valor_total: 50_000_001 }))).bloqueos?.[0]?.codigo).toBe("RC3"))
  test("exactamente en el tope pasa", () =>
    expect(rc3Tope(e(conSolicitud(base, { valor_total: 50_000_000 }))).bloqueos ?? []).toHaveLength(0))
})

describe("RC4 subárea", () => {
  test("pertenece", () => expect(rc4Subarea(e(base)).bloqueos ?? []).toHaveLength(0))
  test("no pertenece", () => expect(rc4Subarea(e(conSolicitud(base, { subarea: "Marketing" }))).bloqueos).toHaveLength(1))
  test("tolera tildes y mayúsculas", () =>
    expect(rc4Subarea(e(conSolicitud(base, { subarea: "INFRAESTRUCTURA" }))).bloqueos ?? []).toHaveLength(0))
})

describe("RC5 cotización", () => {
  test("igual", () => expect(rc5Cotizacion(e(base)).confirmaciones ?? []).toHaveLength(0))
  test("2 % exacto pasa, 2,1 % no", () => {
    const c = base.cotizacion
    if (!c) throw new Error("fixture")
    const con = (total: number) => rc5Cotizacion(e({ ...base, cotizacion: { ...c, total } })).confirmaciones ?? []
    expect(con(11_400_000 * 1.02)).toHaveLength(0)
    expect(con(11_400_000 * 1.021)).toHaveLength(1)
  })
  test("sin cotización → confirmación", () =>
    expect(rc5Cotizacion(e({ ...base, cotizacion: null })).confirmaciones).toHaveLength(1))
  test("la confirmación trae ambos valores", async () => {
    const p4 = await paquete("sol-004")
    const d = rc5Cotizacion(e(p4)).confirmaciones?.[0]?.detalle ?? ""
    expect(d).toContain("26.500.000")
    expect(d).toContain("25.000.000")
  })
})

describe("RC6 IVA", () => {
  test("informado", () => expect(rc6Iva(e(base)).derivados?.indicador_iva?.origen).toBe("solicitud"))
  test("ausente → derivado + confirmación", async () => {
    const r = rc6Iva(e(await paquete("sol-006")))
    expect(r.derivados?.indicador_iva).toEqual({ codigo: "C1", origen: "derivado" })
    expect(r.confirmaciones).toHaveLength(1)
  })
  test("código inexistente → solo advertencia, no bloquea ni confirma", () => {
    const r = rc6Iva(e(conSolicitud(base, { indicador_iva: "ZZ" })))
    expect(r.bloqueos ?? []).toHaveLength(0)
    expect(r.confirmaciones ?? []).toHaveLength(0)
    expect(r.advertencias).toHaveLength(1)
  })
  test("mensaje de derivación sin doble punto", async () => {
    const d = rc6Iva(e(await paquete("sol-006"))).confirmaciones?.[0]?.detalle ?? ""
    expect(d).not.toContain("..")
    expect(d).toEndWith("TecnoSuministros S.A.S.")
  })
})

describe("RC7 condiciones de pago", () => {
  test("informadas", () => expect(rc7Pago(e(base)).derivados?.condiciones_pago?.origen).toBe("solicitud"))
  test("código inexistente → solo advertencia, no bloquea", () => {
    const r = rc7Pago(e(conSolicitud(base, { condiciones_pago: "Z999" })))
    expect(r.bloqueos ?? []).toHaveLength(0)
    expect(r.advertencias).toHaveLength(1)
  })
  test("ausentes → derivadas, sin confirmación", async () => {
    const r = rc7Pago(e(await paquete("sol-006")))
    expect(r.derivados?.condiciones_pago).toEqual({ codigo: "Z030", origen: "derivado" })
    expect(r.confirmaciones ?? []).toHaveLength(0)
  })
})

describe("RC8 retroactiva", () => {
  test("sin factura", () => expect(rc8Retroactiva(e(base)).retroactiva).toBe(false))
  test("factura anterior", async () => {
    const r = rc8Retroactiva(e(await paquete("sol-005")))
    expect(r.retroactiva).toBe(true)
    expect(r.confirmaciones).toHaveLength(1)
  })
  test("factura el mismo día no es retroactiva", async () => {
    const p = await paquete("sol-005")
    const f = p.factura
    if (!f) throw new Error("fixture")
    expect(rc8Retroactiva(e({ ...p, factura: { ...f, fecha: p.solicitud.fecha_solicitud } })).retroactiva).toBe(false)
  })
})

describe("RC9 fecha de aprobación", () => {
  test("posterior", () => expect(rc9FechaAprobacion(e(base)).confirmaciones ?? []).toHaveLength(0))
  test("anterior → confirmación", () =>
    expect(rc9FechaAprobacion(e(conSolicitud(base, { fecha_solicitud: "2026-08-22" }))).confirmaciones).toHaveLength(1))
  test("mismo día (sol-004, 18:45-05:00) pasa", async () =>
    expect(rc9FechaAprobacion(e(await paquete("sol-004"))).confirmaciones ?? []).toHaveLength(0))
})

describe("RC10 aritmética", () => {
  test("cuadra", () => expect(rc10Aritmetica(e(base)).bloqueos ?? []).toHaveLength(0))
  test("±1 tolerado", () =>
    expect(rc10Aritmetica(e(conSolicitud(base, { valor_total: 11_400_001 }))).bloqueos ?? []).toHaveLength(0))
  test("±2 bloquea", () =>
    expect(rc10Aritmetica(e(conSolicitud(base, { valor_total: 11_400_002 }))).bloqueos?.[0]?.codigo).toBe("RC10"))
})
