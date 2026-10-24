import crypto from 'node:crypto';
import { loadOperations } from './config.js';
import { dispatch } from './orchestrator.js';
import { productionApp } from './production.js';
import { containsSensitiveText, safePrompt } from './privacy.js';
import { inspectProjects } from './projects.js';
import { getOperationsView } from './operations/index.js';
import { enqueueRemoteCommand } from './operations/store.js';

const DISCORD_PING = 1;
const DISCORD_APPLICATION_COMMAND = 2;
const EPHEMERAL = 1 << 6;

type DiscordOption = { name?: string; value?: string | number | boolean; options?: DiscordOption[] };
type DiscordInteraction = {
  type?: number;
  guild_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
  data?: { name?: string; options?: DiscordOption[] };
};

const maxClockSkewSeconds = 300;

// Discord only displays a reply delivered with HTTP 200; errors are reported in the message text.
function response(content: string) {
  return Response.json({ type: 4, data: { content: content.slice(0, 1900), flags: EPHEMERAL } });
}

function optionMap(options: DiscordOption[] | undefined) {
  const values = new Map<string, string>();
  for (const option of options ?? []) {
    if (typeof option.value === 'string' || typeof option.value === 'number' || typeof option.value === 'boolean') values.set(option.name ?? '', String(option.value));
    for (const nested of option.options ?? []) {
      if (typeof nested.value === 'string' || typeof nested.value === 'number' || typeof nested.value === 'boolean') values.set(nested.name ?? '', String(nested.value));
    }
  }
  return values;
}

function configuredIds(name: string) {
  return (process.env[name] ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

function verifySignature(body: string, request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!publicKey || !signature || !timestamp || !/^[a-f0-9]{64}$/i.test(publicKey) || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  // The signature covers the timestamp, so rejecting stale timestamps stops captured requests being replayed.
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > maxClockSkewSeconds) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function actorId(interaction: DiscordInteraction) {
  return interaction.member?.user?.id ?? interaction.user?.id ?? '';
}

function statusText(view: Awaited<ReturnType<typeof getOperationsView>>, systemId?: string) {
  const sites = systemId ? view.sites.filter((site) => site.id === systemId) : view.sites;
  if (sites.length === 0) return 'That production system is not registered in Command Deck.';
  const lines = sites.map((site) => {
    const monitor = site.monitor.live === 'online' ? `online (${site.monitor.statusCode ?? 'ok'})` : site.monitor.live;
    const staging = site.staging.status === 'ready' ? 'ready' : site.staging.status;
    return `${site.id}: ${monitor} · staging ${staging} · ${site.agents.count} roles`;
  });
  return [`Command Deck status · ${view.totals.agents} accountable agents`, ...lines, `Privacy: ${view.privacy.mode}; raw retention ${view.privacy.rawLogRetentionMinutes} min; customer access ${view.privacy.customerDataAccess}.`].join('\n');
}

export async function handleDiscordInteraction(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await request.text();
  if (!verifySignature(body, request)) return new Response('Invalid request signature.', { status: 401 });

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return new Response('Invalid interaction.', { status: 400 });
  }
  if (interaction.type === DISCORD_PING) return Response.json({ type: DISCORD_PING });
  if (interaction.type !== DISCORD_APPLICATION_COMMAND) return response('Unsupported Discord interaction.');

  const guildId = process.env.DISCORD_GUILD_ID;
  const owners = [...configuredIds('DISCORD_OWNER_USER_IDS'), ...configuredIds('DISCORD_OWNER_USER_ID')];
  if (!guildId || interaction.guild_id !== guildId || owners.length === 0 || !owners.includes(actorId(interaction))) {
    return response('This Command Deck bot is restricted to its configured owner and private operations server.');
  }

  const command = interaction.data?.name ?? '';
  const options = optionMap(interaction.data?.options);
  if (command === 'help') {
    return response('Command Deck commands:\n/status [system] — read safe production metadata\n/request-change system prompt — queue a reviewed change\n/agent system role prompt — route a request to a role team');
  }
  if (command === 'status') {
    try {
      return response(statusText(await getOperationsView(), options.get('system')));
    } catch {
      return response('Command Deck status is temporarily unavailable.');
    }
  }
  if (command !== 'request-change' && command !== 'agent') return response('Unknown command. Use /help.');

  const prompt = safePrompt(options.get('prompt') ?? '');
  const system = options.get('system') ?? '';
  const role = (options.get('role') ?? 'implementation').trim().toLowerCase();
  let operations: Awaited<ReturnType<typeof loadOperations>>;
  try {
    operations = await loadOperations();
  } catch {
    return response('Command Deck configuration is temporarily unavailable. No request was queued.');
  }
  const systems = operations.apps.map((app) => app.id);
  const roles = operations.agentRoles.map((item) => item.id);
  if (!systems.includes(system)) return response(`Unknown system. Use one of: ${systems.join(', ')}.`);
  if (!roles.includes(role)) return response(`Unknown role. Use one of: ${roles.join(', ')}.`);
  if (prompt.length < 3 || prompt.length > 1200) return response('Provide a prompt between 3 and 1,200 characters.');
  if (containsSensitiveText(prompt)) return response('Remove private identifiers, tokens, paths, IP addresses, and customer content before sending this request.');

  const routedPrompt = `[Discord ${command}; system=${system}; role=${role}] ${prompt}`;
  try {
    if (process.env.VERCEL) {
      const requestId = await enqueueRemoteCommand({ systemId: system, role, prompt: safePrompt(routedPrompt) });
      if (!requestId) return response('The request could not be queued: the operations Supabase queue is not configured or rejected the write. No production change was made.');
      return response(`Queued ${requestId} for ${system} → ${role}. A reviewed changeset and staging gates are required before production.`);
    }
    const appConfig = await productionApp(system);
    const item = await dispatch(routedPrompt, await inspectProjects(), { projectId: appConfig?.projectId ?? system });
    return response(`Queued ${item.id} for ${item.teamName}. The team will prepare a reviewed changeset before any source file is modified.`);
  } catch {
    return response('The request could not be queued. No production change was made.');
  }
}
