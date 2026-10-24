// Registers the Command Deck slash commands in the configured guild.
// Requires DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.
import { loadOperations } from '../server/config.js';

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!applicationId || !botToken || !guildId) {
  console.error('Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID first.');
  process.exit(1);
}

const STRING = 3;
const operations = await loadOperations();
const systemChoices = operations.apps.map((app) => ({ name: app.id, value: app.id }));
const roleChoices = operations.agentRoles.map((role) => ({ name: role.name, value: role.id }));
const system = (required: boolean) => ({ type: STRING, name: 'system', description: 'Production system', required, choices: systemChoices });
const prompt = { type: STRING, name: 'prompt', description: 'What should be done (no customer data or secrets)', required: true, max_length: 1200 };

const commands = [
  { name: 'help', description: 'List Command Deck commands' },
  { name: 'status', description: 'Read safe production metadata', options: [system(false)] },
  { name: 'request-change', description: 'Queue a reviewed change for a production system', options: [system(true), prompt] },
  { name: 'agent', description: 'Route a request to a role team', options: [system(true), { type: STRING, name: 'role', description: 'Agent role', required: true, choices: roleChoices }, prompt] },
];

const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});
if (!response.ok) {
  console.error(`Discord rejected the registration (HTTP ${response.status}).`);
  process.exit(1);
}
console.log(`Registered ${commands.length} commands in guild ${guildId}.`);
