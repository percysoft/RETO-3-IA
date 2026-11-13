import { describe, expect, test } from "bun:test"
import { resolverIpCliente, type ConfianzaProxy } from "../src/seguridad.ts"
import { post, servidorDePrueba, texto } from "./falso.ts"

const off: ConfianzaProxy = { activo: false, cabecera: "x-forwarded-for", saltos: 1 }
const on = (saltos = 1, cabecera = "x-forwarded-for"): ConfianzaProxy => ({ activo: true, cabecera, saltos })
const h = (valor: string, nombre = "x-forwarded-for") => new Headers({ [nombre]: valor })

describe("resolverIpCliente", () => {
  test("TRUST_PROXY desactivado: se ignora cualquier cabecera", () => {
    expect(resolverIpCliente(h("1.2.3.4"), "10.0.0.9", off)).toBe("10.0.0.9")
  })
  test("activado: usa la entrada N-ésima desde la DERECHA; las de la izquierda (falsificables) se ignoran", () => {
    const cadena = h("6.6.6.6, 1.2.3.4, 10.1.1.1")
    expect(resolverIpCliente(cadena, "10.0.0.9", on(1))).toBe("10.1.1.1")
    expect(resolverIpCliente(cadena, "10.0.0.9", on(2))).toBe("1.2.3.4")
    expect(resolverIpCliente(cadena, "10.0.0.9", on(3))).toBe("6.6.6.6")
  })
  test("un cliente que antepone una IP falsa no cambia el resultado con saltos=1", () => {
    expect(resolverIpCliente(h("8.8.8.8, 203.0.113.5"), "10.0.0.9", on(1))).toBe("203.0.113.5")
    expect(resolverIpCliente(h("203.0.113.5"), "10.0.0.9", on(1))).toBe("203.0.113.5")
  })
  test("cabecera ausente, vacía, con menos entradas que saltos o con valores inválidos → IP del socket", () => {
    expect(resolverIpCliente(new Headers(), "10.0.0.9", on(1))).toBe("10.0.0.9")
    expect(resolverIpCliente(h(""), "10.0.0.9", on(1))).toBe("10.0.0.9")
    expect(resolverIpCliente(h("1.2.3.4"), "10.0.0.9", on(2))).toBe("10.0.0.9")
    expect(resolverIpCliente(h("no-es-una-ip"), "10.0.0.9", on(1))).toBe("10.0.0.9")
    expect(resolverIpCliente(h("1.2.3.4, <script>"), "10.0.0.9", on(1))).toBe("10.0.0.9")
  })
  test("admite IPv6, puertos y otra cabecera de una sola IP", () => {
    expect(resolverIpCliente(h("2001:db8::1"), "10.0.0.9", on(1))).toBe("2001:db8::1")
    expect(resolverIpCliente(h("[2001:db8::2]:443"), "10.0.0.9", on(1))).toBe("2001:db8::2")
    expect(resolverIpCliente(h("1.2.3.4:5555"), "10.0.0.9", on(1))).toBe("1.2.3.4")
    expect(resolverIpCliente(h("203.0.113.7", "cf-connecting-ip"), "10.0.0.9", on(1, "cf-connecting-ip"))).toBe("203.0.113.7")
  })
})

describe("límite por IP con y sin confianza en el proxy", () => {
  test("sin confianza (por defecto): falsificar X-Forwarded-For NO evita el límite", async () => {
    const { fetch } = await servidorDePrueba([texto("a"), texto("b"), texto("c")], { limiteChatPorMinuto: 2 })
    const estados: number[] = []
    for (let i = 0; i < 3; i++) estados.push((await fetch(post("/api/chat", { message: "x" }, { "X-Forwarded-For": `5.5.5.${i}` }), "10.0.0.9")).status)
    expect(estados).toEqual([200, 200, 429])
  })
  test("con confianza (saltos=1): cada IP real tiene su cubo y anteponer IPs falsas no ayuda", async () => {
    const { fetch } = await servidorDePrueba([texto("a"), texto("b"), texto("c"), texto("d")], { limiteChatPorMinuto: 2, trustProxy: on(1) })
    const desde = (cadena: string) => fetch(post("/api/chat", { message: "x" }, { "X-Forwarded-For": cadena }), "10.0.0.9")
    expect((await desde("203.0.113.5")).status).toBe(200)
    expect((await desde("1.1.1.1, 203.0.113.5")).status).toBe(200) // mismo cliente real, otra cola falsa
    expect((await desde("2.2.2.2, 203.0.113.5")).status).toBe(429) // sigue siendo 203.0.113.5
    expect((await desde("198.51.100.9")).status).toBe(200) // otro cliente real: cubo propio
  })
})
