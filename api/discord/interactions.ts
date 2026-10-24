import { handleDiscordInteraction } from '../../server/discord.js';

// Vercel's Node runtime passes a Web Request only to named HTTP-method exports.
export async function POST(request: Request): Promise<Response> {
  return handleDiscordInteraction(request);
}
