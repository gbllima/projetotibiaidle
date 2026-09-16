import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const CHAT_ACT_PATH = /^\/api\/characters\/\d+\/act(?:\?.*)?$/;

const BLOCKED_ACRONYMS = new Set(['fdp', 'vsf', 'pqp', 'tnc']);

const BLOCKED_WORD_PATTERNS = [
  /^caralh(?:o|os|inho|inhos|ao|oes)$/,
  /^porr(?:a|as|inha|inhas|ao|oes)$/,
  /^merd(?:a|as|inha|inhas|ao|oes)$/,
  /^put(?:a|as|o|os|inha|inhas|inho|inhos|ao|oes)$/,
  /^putari(?:a|as)$/,
  /^fod(?:a|as|e|er|eu|endo|ido|ida|idos|idas|ase|asse|am|emos|em)$/,
  /^bucet(?:a|as|inha|inhas|ao|oes)$/,
  /^arrombad[oa]s?$/,
  /^desgracad[oa]s?$/,
  /^vagabund[oa]s?$/,
  /^piranh(?:a|as)$/,
  /^viad(?:o|os|inho|inhos)$/,
  /^bost(?:a|as|inha|inhas)$/,
  /^cacet(?:e|es)$/,
  /^escrot[oa]s?$/,
  /^piroc(?:a|as|ao|oes)$/,
  /^cuza(?:o|os)$/,
];

const BLOCKED_PHRASES = [
  /\btomar\s+no\s+cu\b/,
  /\bpau\s+no\s+cu\b/,
];

function normalizeChatText(message: string): string {
  return message
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/9/g, 'g');
}

function reduceStretching(token: string): string {
  return token
    .replace(/([aeiou])\1+/g, '$1')
    .replace(/([^aeiou])\1{2,}/g, '$1$1');
}

function profanityCandidates(message: string): string[] {
  const normalized = normalizeChatText(message);
  const compactPunctuation = normalized.replace(/(?<=[a-z0-9])[-_.]+(?=[a-z0-9])/g, '');
  const tokens = compactPunctuation.split(/[^a-z0-9]+/).filter(Boolean);
  const candidates = tokens.map(reduceStretching);

  const spacedTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  let singleLetterRun = '';
  for (const token of spacedTokens) {
    if (token.length === 1) {
      singleLetterRun += token;
      if (singleLetterRun.length >= 3 && singleLetterRun.length <= 16) {
        candidates.push(reduceStretching(singleLetterRun));
      }
      if (singleLetterRun.length > 16) singleLetterRun = token;
    } else {
      singleLetterRun = '';
    }
  }

  return candidates;
}

export function containsRestrictedChatProfanity(message: string): boolean {
  const normalizedPhrase = normalizeChatText(message).replace(/[^a-z0-9]+/g, ' ').trim();
  if (BLOCKED_PHRASES.some((pattern) => pattern.test(normalizedPhrase))) return true;

  return profanityCandidates(message).some((candidate) =>
    BLOCKED_ACRONYMS.has(candidate)
    || BLOCKED_WORD_PATTERNS.some((pattern) => pattern.test(candidate)),
  );
}

function rejectProfanity(reply: FastifyReply) {
  return reply.status(422).send({
    error: 'Palavras de baixo calão não são permitidas no chat interno.',
  });
}

export function registerChatProfanityProtection(app: FastifyInstance): void {
  app.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'POST' || !CHAT_ACT_PATH.test(request.url)) return;

    const body = (request.body ?? {}) as { type?: unknown; body?: unknown };
    if (String(body.type ?? '') !== 'chat') return;

    const message = String(body.body ?? '');
    if (containsRestrictedChatProfanity(message)) return rejectProfanity(reply);
  });
}
