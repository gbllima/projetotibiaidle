import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from './db.js';

const AUDIT_KEY = 'admin:audit:v1';
const AUDIT_LIMIT = 10_000;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 1_500;
const PASSWORD_FIELDS = new Set(['password']);

const SOURCE_PROBE = /(?:^|\/)(?:\.git|node_modules|src)(?:\/|$)|(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|\.env(?:\.[^/]*)?|[^/]+\.(?:map|tsx?|jsx))(?:$|\?)/i;
const MALFORMED_URL = /%00|(?:%2e){2}(?:%2f|%5c|\/|\\)/i;

const EXECUTABLE_INPUT_PATTERNS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'tag script', pattern: /<\s*\/?\s*script\b/i },
  { reason: 'conteúdo ativo HTML', pattern: /<\s*\/?\s*(?:iframe|object|embed|svg|math|link|meta|base)\b/i },
  { reason: 'handler JavaScript em HTML', pattern: /\bon[a-z]{3,}\s*=/i },
  { reason: 'protocolo JavaScript', pattern: /\b(?:javascript|vbscript)\s*:/i },
  { reason: 'data URL executável', pattern: /\bdata\s*:\s*(?:text\/html|image\/svg\+xml)/i },
  { reason: 'atributo srcdoc', pattern: /\bsrcdoc\s*=/i },
  { reason: 'acesso a cookie/documento', pattern: /\bdocument\s*\.\s*(?:cookie|domain|write|writeln)\b/i },
  { reason: 'execução dinâmica de código', pattern: /\b(?:eval|Function)\s*\(/i },
  { reason: 'template de execução', pattern: /<%[=-]?|\{\{\s*(?:constructor|__proto__)\b/i },
];

function appendSecurityAudit(
  db: Database,
  request: FastifyRequest,
  action: string,
  reason: string,
  details: Record<string, unknown> = {},
): void {
  try {
    const raw = db.getWorld(AUDIT_KEY);
    let audit: Array<Record<string, unknown>> = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) audit = parsed.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
      } catch {
        audit = [];
      }
    }

    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    const accountId = token ? db.accountIdForToken(token) : null;
    const account = accountId === null ? null : db.findAccountById(accountId);
    const characterMatch = request.url.match(/\/api\/(?:characters|market-v2)\/(\d+)/);
    const characterId = characterMatch ? Number(characterMatch[1]) : undefined;
    const character = characterId ? db.findCharacter(characterId) : null;
    const now = Date.now();

    audit.push({
      id: `${now}-security-${action}-${Math.random().toString(36).slice(2, 8)}`,
      category: 'security',
      action,
      ...(accountId === null ? {} : { accountId }),
      ...(account?.username ? { username: account.username } : {}),
      ...(characterId ? { characterId } : {}),
      ...(character?.name ? { actor: character.name } : {}),
      summary: `Requisição de segurança bloqueada em ${request.method} ${request.url.split('?')[0] ?? request.url}.`,
      details: {
        method: request.method,
        path: request.url.split('?')[0] ?? request.url,
        ...details,
      },
      suspicious: true,
      reason,
      createdAt: now,
    });
    db.setWorld(AUDIT_KEY, JSON.stringify(audit.slice(-AUDIT_LIMIT)));
  } catch {
    // Security telemetry must never break the request pipeline.
  }
}

function executableInputReason(value: string): string | null {
  const normalized = value.normalize('NFKC');
  if (normalized.includes('\u0000')) return 'byte nulo em campo de texto';
  for (const entry of EXECUTABLE_INPUT_PATTERNS) {
    if (entry.pattern.test(normalized)) return entry.reason;
  }
  return null;
}

function inspectJson(
  value: unknown,
  state: { nodes: number },
  path = '$',
  depth = 0,
): { reason: string; field: string } | null {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES) return { reason: 'payload JSON excessivamente complexo', field: path };
  if (depth > MAX_JSON_DEPTH) return { reason: 'payload JSON profundamente aninhado', field: path };

  if (typeof value === 'string') {
    const fieldName = path.split('.').at(-1)?.replace(/\[\d+\]$/, '') ?? '';
    if (PASSWORD_FIELDS.has(fieldName)) return null;
    const reason = executableInputReason(value);
    return reason ? { reason, field: path } : null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = inspectJson(value[index], state, `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === '__proto__' || normalizedKey === 'prototype' || normalizedKey === 'constructor') {
      return { reason: 'chave de prototype pollution', field: `${path}.${key}` };
    }
    const found = inspectJson(child, state, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

function addSecurityHeaders(request: FastifyRequest, reply: FastifyReply): void {
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' ws: wss:",
    "manifest-src 'self'",
  ].join('; ');

  reply.header('Content-Security-Policy', csp);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('X-Permitted-Cross-Domain-Policies', 'none');
  reply.header('X-DNS-Prefetch-Control', 'off');
  if (process.env['NODE_ENV'] === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
}

export function registerSecurityHardening(app: FastifyInstance, db: Database): void {
  app.addHook('onRequest', async (request, reply) => {
    addSecurityHeaders(request, reply);

    const path = request.url.split('?')[0] ?? request.url;
    if ((request.method === 'GET' || request.method === 'HEAD') && SOURCE_PROBE.test(path)) {
      appendSecurityAudit(db, request, 'source_probe', 'tentativa de acesso a arquivo de código-fonte ou configuração', { path });
      return reply.status(404).send({ error: 'Not found.' });
    }
    if (MALFORMED_URL.test(request.url)) {
      appendSecurityAudit(db, request, 'malformed_url', 'URL com sequência de traversal ou byte nulo');
      return reply.status(400).send({ error: 'Requisição inválida.' });
    }
  });

  app.addHook('preValidation', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return;
    if (request.body === undefined || request.body === null) return;

    const problem = inspectJson(request.body, { nodes: 0 });
    if (!problem) return;

    appendSecurityAudit(db, request, 'code_injection_blocked', problem.reason, { field: problem.field });
    return reply.status(422).send({
      error: 'Conteúdo potencialmente executável ou malformado não é permitido.',
    });
  });
}
