/**
 * ssrf-guard.js — Proteção contra SSRF e DNS Rebinding.
 *
 * Funções exportadas:
 *   assertSafeUrl(url)                    — valida que a URL não aponta para IP privado.
 *                                           Uso: antes de persistir URLs de webhook.
 *   resolveToSafeIp(url)                  — resolve DNS, valida IP e retorna dados de conexão.
 *                                           Uso: antes de realizar requisição HTTP de saída.
 *   makeSecureRequest(conn, headers, body) — POST via IP resolvido (anti-rebinding).
 *                                           Uso: dispatcher + testWebhook.
 */

import dns   from 'node:dns/promises'
import net   from 'node:net'
import https from 'node:https'
import http  from 'node:http'

const TIMEOUT_MS = 5_000

/**
 * Valida que a URL é segura para requisição de saída.
 * Lança erro com status 422 se a URL for inválida ou resolver para IP bloqueado.
 * Uso: validação antes de PERSISTIR URLs (create/update webhook).
 */
export async function assertSafeUrl(rawUrl) {
  await resolveToSafeIp(rawUrl)  // valida; descarta resultado
}

/**
 * Resolve DNS e valida que o IP não é privado/reservado.
 * Retorna dados de conexão para uso direto em makeSecureRequest.
 *
 * Prevenção de DNS Rebinding: a resolução DNS acontece UMA VEZ aqui.
 * O chamador usa o IP retornado para a conexão TCP — sem nova resolução.
 * Sem esse padrão, um segundo lookup em fetch() poderia retornar um IP
 * diferente (privado), contornando a validação inicial.
 *
 * @param {string} rawUrl
 * @returns {{ resolvedIp: string, hostname: string, protocol: string, port: number, pathname: string, search: string }}
 */
export async function resolveToSafeIp(rawUrl) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw Object.assign(new Error('URL inválida.'), { status: 422 })
  }

  const { protocol, hostname: raw, port, pathname, search } = parsed

  if (protocol !== 'https:' && protocol !== 'http:') {
    throw Object.assign(
      new Error('Apenas URLs http:// e https:// são permitidas.'),
      { status: 422 }
    )
  }

  const hostname      = raw.replace(/^\[|\]$/g, '')
  const effectivePort = port ? parseInt(port, 10) : (protocol === 'https:' ? 443 : 80)

  let resolvedIp

  if (net.isIPv4(hostname)) {
    assertNotPrivateIpv4(hostname)
    resolvedIp = hostname
  } else if (net.isIPv6(hostname)) {
    assertNotPrivateIpv6(hostname)
    resolvedIp = hostname
  } else {
    let addresses
    try {
      addresses = await dns.lookup(hostname, { all: true })
    } catch {
      throw Object.assign(
        new Error(`Não foi possível resolver o hostname: ${hostname}`),
        { status: 422 }
      )
    }
    if (!addresses.length) {
      throw Object.assign(
        new Error(`Hostname não resolveu para nenhum IP: ${hostname}`),
        { status: 422 }
      )
    }
    for (const { address, family } of addresses) {
      if (family === 4) assertNotPrivateIpv4(address)
      else              assertNotPrivateIpv6(address)
    }
    resolvedIp = addresses[0].address
  }

  return {
    resolvedIp,
    hostname,
    protocol,
    port:     effectivePort,
    pathname: pathname || '/',
    search:   search   || '',
  }
}

/**
 * Executa requisição POST HTTP/HTTPS para o IP previamente resolvido e validado.
 *
 * Previne DNS Rebinding: a conexão TCP vai ao IP fixo — sem nova resolução DNS.
 * Para HTTPS: `servername` garante que o certificado seja validado contra o
 * hostname original (não o IP), respeitando SNI e o handshake TLS correto.
 *
 * @param {object} conn        — retorno de resolveToSafeIp()
 * @param {object} headers     — headers HTTP adicionais (ex: Content-Type, x-signature-256)
 * @param {string} body        — corpo serializado
 * @param {number} [timeoutMs] — timeout em ms (padrão: 5 000)
 * @returns {{ statusCode: number }}
 */
export function makeSecureRequest(conn, headers, body, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const transport = conn.protocol === 'https:' ? https : http

    const options = {
      hostname: conn.resolvedIp,
      port:     conn.port,
      path:     conn.pathname + conn.search,
      method:   'POST',
      headers:  {
        'Host':           conn.hostname,
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      // SNI: cert validado contra hostname original, não o IP
      ...(conn.protocol === 'https:' ? { servername: conn.hostname } : {}),
    }

    let done = false

    const timer = setTimeout(() => {
      if (done) return
      done = true
      req.destroy(Object.assign(new Error('Request timeout'), { isTimeout: true }))
    }, timeoutMs)

    const req = transport.request(options, (res) => {
      if (done) return
      done = true
      clearTimeout(timer)
      res.resume()  // drena corpo para liberar o socket
      resolve({ statusCode: res.statusCode })
    })

    req.on('error', (err) => {
      if (done) return
      done = true
      clearTimeout(timer)
      reject(err)
    })

    req.write(body)
    req.end()
  })
}

// ── Verificadores de faixa ────────────────────────────────────────────────────

function assertNotPrivateIpv4(ip) {
  const [a, b, c] = ip.split('.').map(Number)

  const blocked =
    a === 0 ||                                   // 0.0.0.0/8      — "this" network
    a === 10 ||                                  // 10.0.0.0/8     — private
    a === 127 ||                                 // 127.0.0.0/8    — loopback
    (a === 100 && b >= 64 && b <= 127) ||        // 100.64.0.0/10  — CGNAT
    (a === 169 && b === 254) ||                  // 169.254.0.0/16 — link-local / AWS metadata
    (a === 172 && b >= 16  && b <= 31) ||        // 172.16.0.0/12  — private
    (a === 192 && b === 0  && c === 0) ||        // 192.0.0.0/24   — IETF protocol
    (a === 192 && b === 168) ||                  // 192.168.0.0/16 — private
    (a === 198 && (b === 18 || b === 19)) ||     // 198.18.0.0/15  — benchmarking
    a >= 224                                     // 224+           — multicast / reserved

  if (blocked) {
    throw Object.assign(
      new Error(`IP bloqueado por política de segurança (SSRF): ${ip}`),
      { status: 422 }
    )
  }
}

function assertNotPrivateIpv6(ip) {
  const lower = ip.toLowerCase()

  const blocked =
    lower === '::1'           ||  // loopback
    lower === '::'            ||  // unspecified
    lower.startsWith('fe80:') ||  // fe80::/10 — link-local
    lower.startsWith('fc')   ||  // fc00::/7  — ULA
    lower.startsWith('fd')   ||  // fd00::/8  — ULA
    lower.startsWith('ff')       // ff00::/8  — multicast

  if (blocked) {
    throw Object.assign(
      new Error(`IP bloqueado por política de segurança (SSRF): ${ip}`),
      { status: 422 }
    )
  }
}
