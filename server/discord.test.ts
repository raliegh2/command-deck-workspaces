import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleDiscordInteraction } from './discord.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

beforeAll(() => {
  // The raw 32-byte key is the tail of the DER-encoded SPKI structure.
  process.env.DISCORD_PUBLIC_KEY = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  process.env.DISCORD_GUILD_ID = 'guild-1';
  process.env.DISCORD_OWNER_USER_ID = 'owner-1';
});

function signed(body: unknown, timestamp = Math.floor(Date.now() / 1000)) {
  const text = JSON.stringify(body);
  const signature = crypto.sign(null, Buffer.from(timestamp + text), privateKey).toString('hex');
  return new Request('https://deck.example/api/discord/interactions', {
    method: 'POST',
    headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': String(timestamp) },
    body: text,
  });
}

const command = (name: string, options: Array<{ name: string; value: string }>, user = 'owner-1') => ({
  type: 2, guild_id: 'guild-1', member: { user: { id: user } }, data: { name, options },
});

async function content(response: Response) {
  return ((await response.json()) as { data: { content: string } }).data.content;
}

describe('Discord interactions', () => {
  it('answers a signed ping', async () => {
    const response = await handleDiscordInteraction(signed({ type: 1 }));
    expect(await response.json()).toEqual({ type: 1 });
  });

  it('rejects a validly signed but stale request (replay)', async () => {
    const response = await handleDiscordInteraction(signed({ type: 1 }, Math.floor(Date.now() / 1000) - 3600));
    expect(response.status).toBe(401);
  });

  it('rejects a tampered body', async () => {
    const request = signed({ type: 1 });
    const tampered = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ type: 2 }) });
    expect((await handleDiscordInteraction(tampered)).status).toBe(401);
  });

  it('replies with HTTP 200 so Discord shows refusals to the user', async () => {
    const response = await handleDiscordInteraction(signed(command('help', [], 'intruder')));
    expect(response.status).toBe(200);
    expect(await content(response)).toContain('restricted');
  });

  it('explains an unknown role instead of a misleading queue error', async () => {
    const response = await handleDiscordInteraction(signed(command('agent', [
      { name: 'system', value: 'example-care' }, { name: 'role', value: 'Frontend Lead' }, { name: 'prompt', value: 'fix the header' },
    ])));
    expect(response.status).toBe(200);
    expect(await content(response)).toContain('Unknown role');
  });

  it('rejects an unregistered system', async () => {
    const response = await handleDiscordInteraction(signed(command('request-change', [
      { name: 'system', value: 'not-a-system' }, { name: 'prompt', value: 'fix the header' },
    ])));
    expect(await content(response)).toContain('Unknown system');
  });
});
