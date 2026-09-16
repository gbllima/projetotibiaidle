import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const CHAT_ACT_PATH = /^\/api\/characters\/\d+\/act(?:\?.*)?$/;

const LINK_PATTERNS = [
  /\b(?:https?|ftp):\/\/[^\s]+/i,
  /\bwww\.[^\s]+/i,
  /\b(?:discord\.gg|discord(?:app)?\.com\/invite|t\.me|wa\.me)\/[^\s]+/i,
  /(?:^|[\s([{>])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.br|net\.br|org\.br|com|net|org|gg|io|dev|app|xyz|online|site|me|tv|br)(?=$|[\s/:?#),.!\]}>])/i,
];

export function containsRestrictedChatLink(message: string): boolean {
  const normalized = message.normalize('NFKC');
  return LINK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function rejectLink(reply: FastifyReply) {
  return reply.status(422).send({
    error: 'Links não são permitidos no chat interno.',
  });
}

export function registerChatLinkProtection(app: FastifyInstance): void {
  app.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST' || !CHAT_ACT_PATH.test(request.url)) return;

    const body = (request.body ?? {}) as { type?: unknown; body?: unknown };
    if (String(body.type ?? '') !== 'chat') return;

    const message = String(body.body ?? '');
    if (containsRestrictedChatLink(message)) return rejectLink(reply);
  });
}
