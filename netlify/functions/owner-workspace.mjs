import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import auth from './_auth.js';

const MAX_FILE = 48 * 1024;
const MAX_STORE = 4 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (status, body) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const failure = (status, error) => json(status, { error });
const discordId = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const initial = () => ({ scripts: [], licenses: [], audit: [] });
const metadata = ({ scripts, licenses, audit }) => ({
  scripts: scripts.map(({ source, ...item }) => item),
  licenses: licenses.map(({ digest, ...item }) => item),
  audit: audit.slice(0, 120),
});

function change(data, input, user) {
  const action = input.action;
  const script = data.scripts.find(item => item.id === input.id);
  const license = data.licenses.find(item => item.id === input.id);
  const now = new Date().toISOString();

  switch (action) {
    case 'upload': {
      const { name, source, project } = input;
      if (typeof name !== 'string' || !/^[\w .-]{1,90}\.(lua|luau)$/i.test(name) ||
          typeof source !== 'string' || !source.trim() || source.includes('\0') ||
          Buffer.byteLength(source) > MAX_FILE) return [422, { error: 'Envie um arquivo Lua/Luau UTF-8 de até 48 KB.' }];
      if (project && !data.scripts.some(item => item.project === project)) return [404, { error: 'Script original não encontrado.' }];
      const group = project || randomUUID();
      const version = Math.max(0, ...data.scripts.filter(item => item.project === group).map(item => item.version)) + 1;
      const item = { id: randomUUID(), project: group, name, source, version, state: 'draft', createdAt: now };
      data.scripts.unshift(item);
      return [201, { id: item.id }];
    }
    case 'publish':
    case 'unpublish':
    case 'remove': {
      if (!script || script.state === 'removed') return [404, { error: 'Versão não encontrada.' }];
      if (action === 'publish') {
        for (const item of data.scripts) {
          if (item.project === script.project && item.state === 'published') item.state = 'draft';
        }
      }
      script.state = { publish: 'published', unpublish: 'draft', remove: 'removed' }[action];
      if (action === 'remove') delete script.source;
      return [200, { id: script.id }];
    }
    case 'issue': {
      if (input.user && !discordId(input.user)) return [422, { error: 'Discord ID inválido.' }];
      if (data.licenses.length >= 2000) return [409, { error: 'Limite de licenças atingido.' }];
      const key = 'WYRIX-' + randomBytes(24).toString('base64url');
      const item = { id: randomUUID(), digest: hash(key), user: input.user || null, redeemedAt: null, revokedAt: null, createdAt: now };
      data.licenses.unshift(item);
      return [201, { id: item.id, key }];
    }
    case 'revoke':
      if (!license) return [404, { error: 'Licença não encontrada.' }];
      license.revokedAt ||= now;
      return [200, { id: license.id }];
    case 'redeem': {
      if (typeof input.key !== 'string' || !/^WYRIX-[\w-]{32}$/.test(input.key)) {
        return [403, { error: 'Licença inválida ou indisponível.' }];
      }
      const digest = hash(input.key);
      const item = data.licenses.find(entry => entry.digest === digest);
      if (!item || item.revokedAt || (item.user && item.user !== user)) return [403, { error: 'Licença inválida ou indisponível.' }];
      item.user = user;
      item.redeemedAt ||= now;
      return [200, { id: item.id }];
    }
    default:
      return [400, { error: 'Ação inválida.' }];
  }
}

export default async request => {
  const url = new URL(request.url);
  const session = auth.decode(auth.getCookie({ headers: { cookie: request.headers.get('cookie') } }, 'wyrix_session'));
  if (!discordId(session?.id)) return failure(401, 'Entre com Discord.');
  const user = session.id;
  const owner = user === auth.ownerId;
  const view = url.searchParams.get('view');

  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return failure(403, 'Origem não autorizada.');
  if (!['GET', 'POST'].includes(request.method)) return failure(405, 'Método não permitido.');

  try {
    let input;
    if (request.method === 'POST') {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return failure(415, 'Envie JSON.');
      const body = await request.text();
      if (Buffer.byteLength(body) > 320 * 1024) return failure(413, 'Envio muito grande.');
      try { input = JSON.parse(body); } catch { return failure(400, 'JSON inválido.'); }
    }

    const memberView = request.method === 'GET' && ['library', 'download'].includes(view);
    if (!owner && !memberView && input?.action !== 'redeem') {
      console.warn(JSON.stringify({ event: 'owner_access_denied', actor: user }));
      return failure(403, 'Acesso reservado ao Owner.');
    }

    const store = getStore({ name: 'wyrix-owner-v1', consistency: 'strong' });
    const entry = await store.getWithMetadata('workspace', { type: 'json' });
    const data = entry?.data ?? initial();

    if (request.method === 'GET') {
      const licensed = data.licenses.some(item => item.user === user && item.redeemedAt && !item.revokedAt);
      if (view === 'library') {
        const { scripts } = metadata(data);
        return json(200, { licensed, scripts: owner || licensed ? scripts.filter(item => item.state === 'published') : [] });
      }
      if (view === 'download') {
        const item = data.scripts.find(script => script.id === url.searchParams.get('id'));
        if (!item || item.state === 'removed' || (!owner && (!licensed || item.state !== 'published'))) {
          return failure(404, 'Versão indisponível.');
        }
        return new Response(item.source, { headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="' + item.name + '"',
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        } });
      }
      return json(200, metadata(data));
    }

    if (!input || typeof input !== 'object') return failure(400, 'Ação inválida.');
    const [status, result] = change(data, input, user);
    if (status >= 400) {
      if (input.action === 'redeem') console.warn(JSON.stringify({ event: 'license_redeem_denied', actor: user }));
      return json(status, result);
    }
    data.audit.unshift({ at: new Date().toISOString(), actor: user, action: input.action, target: result.id });
    data.audit.length = Math.min(data.audit.length, 750);
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_STORE) return failure(409, 'Armazenamento cheio.');
    const options = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const saved = await store.setJSON('workspace', data, options);
    if (!saved.modified) return failure(409, 'Outra ação foi salva primeiro. Atualize e tente novamente.');
    return json(status, result);
  } catch (error) {
    console.error(JSON.stringify({ event: 'owner_storage_error', name: error?.name }));
    return failure(503, 'Armazenamento temporariamente indisponível.');
  }
};
