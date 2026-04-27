// Shared URL validation for endpoints that drive a browser to user-supplied
// URLs (POM scan / static scan). Blocks non-http(s) protocols and private /
// loopback / link-local IP ranges to prevent SSRF against internal services.

import { isIP } from 'node:net';

export interface ValidateUrlOptions {
  /** Allow loopback / RFC1918 / link-local. Default false. */
  allowPrivate?: boolean;
}

const PRIVATE_V4_RANGES: Array<[number, number, number]> = [
  // range start, range end, mask bits (for documentation)
  [10 << 24, (10 << 24) + (1 << 24) - 1, 8],          // 10.0.0.0/8
  [(172 << 24) + (16 << 16), (172 << 24) + (32 << 16) - 1, 12], // 172.16.0.0/12
  [(192 << 24) + (168 << 16), (192 << 24) + (169 << 16) - 1, 16], // 192.168.0.0/16
  [127 << 24, (127 << 24) + (1 << 24) - 1, 8],        // 127.0.0.0/8 loopback
  [(169 << 24) + (254 << 16), (169 << 24) + (255 << 16) - 1, 16], // 169.254.0.0/16 link-local
  [0, (1 << 24) - 1, 8],                                // 0.0.0.0/8
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (!Number.isFinite(v) || v < 0 || v > 255 || String(v) !== p) return null;
    n = (n << 8) + v;
  }
  // JS bitwise operates on signed 32-bit — shift to unsigned.
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4_RANGES.some(([start, end]) => n >= start && n <= end);
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;       // fc00::/7 ULA
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  // IPv4-mapped (::ffff:10.0.0.1)
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

/**
 * Validate a user-supplied URL before launching a browser at it.
 * Throws an Error with an explanatory message on failure.
 */
export function validatePublicUrl(input: string, opts: ValidateUrlOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid url: ${input}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol "${parsed.protocol}" — only http and https are allowed`);
  }
  if (opts.allowPrivate) return parsed;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  const ipKind = isIP(hostname);

  if (ipKind === 4 && isPrivateV4(hostname)) {
    throw new Error(`Target URL points at a private/loopback address (${hostname})`);
  }
  if (ipKind === 6 && isPrivateV6(hostname)) {
    throw new Error(`Target URL points at a private/loopback address (${hostname})`);
  }
  // Block obvious localhost hostnames without resolving DNS. Full DNS-rebinding
  // defence requires resolving + re-checking at fetch time, which the caller
  // (Playwright) doesn't expose — this is best-effort.
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) {
    throw new Error(`Target URL points at localhost (${hostname})`);
  }
  return parsed;
}
