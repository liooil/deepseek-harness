const DSH_WEB_READY = /(?:^|\s)dsh web:\s+(https?:\/\/[^\s,]+)/

/** Extract the stable dsh-web readiness URL without accepting a non-loopback origin. */
export function extractDshWebUrl(line: string): URL | undefined {
  const raw = DSH_WEB_READY.exec(line)?.[1]
  if (!raw) return undefined

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return undefined
  return url
}
