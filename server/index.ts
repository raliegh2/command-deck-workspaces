import {startEngineering} from './engineering.js';
import {startResearchMonitoring} from './research-management.js';
import {startTradingIntelligence} from './trading-intelligence.js';
import {startCloudDiscord,stopCloudDiscord} from './cloud-discord.js';
import {startWorkerTelemetry,stopWorkerTelemetry} from './worker-telemetry.js';
import {startProductionWatch} from './production-watch.js';
import { createApp, serveWebBuild, useErrorHandler } from './app.js';
import { useStoredApiToken } from './security.js';
import { dataDir, initStore } from './store.js';
import { neuralMemory } from './neural-memory.js';
import { vaultRoot } from './knowledge.js';
import {startSystemMaintenance} from './system-tools.js';

// Command Deck reads and writes local project folders, so it only ever listens on loopback and is
// never deployed as a hosted function. The Vercel functions in api/ import server modules directly.
const port = Number(process.env.PORT ?? 8788);
// This local workspace is configured for zero paid-provider execution.
process.env.COMMAND_DECK_ENABLE_PAID_HARNESSES='0';
process.env.OLLAMA_HOST='127.0.0.1:11434';
process.env.OLLAMA_NO_CLOUD='1';
const app = createApp(port);
await serveWebBuild(app);
useErrorHandler(app);
await initStore();
await useStoredApiToken(dataDir);
app.listen(port, '127.0.0.1', () => console.log('Command Deck listening on http://127.0.0.1:' + port));
// Incremental local maintenance while the hub runs. No paid model calls.
const maintainMemory=()=>void neuralMemory().then(m=>m.startIndex(vaultRoot)).catch(()=>console.warn('Local memory maintenance unavailable.'));
if(process.env.COMMAND_DECK_MEMORY_AUTOINDEX!=='0'){
  maintainMemory();
  setInterval(maintainMemory,15*60_000).unref();
}

startProductionWatch();
startSystemMaintenance();
startResearchMonitoring();
startTradingIntelligence();

startWorkerTelemetry();
process.once('exit',stopWorkerTelemetry);
startCloudDiscord();
process.once('exit',stopCloudDiscord);

const stopEngineering=startEngineering();
process.once('exit',stopEngineering);
