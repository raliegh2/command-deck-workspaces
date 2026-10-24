// Runs one monitoring cycle locally. Pass --alerts to also send urgent Discord alerts, and
// --scheduled to count this run toward failure streaks the way the Vercel cron does.
import { runMonitoringCycle } from '../server/operations/monitor.js';

const sendAlerts = process.argv.includes('--alerts');
const scheduled = process.argv.includes('--scheduled');
const snapshot = await runMonitoringCycle({ sendAlerts, scheduled });
for (const site of snapshot.sites) {
  console.log(`${site.id}: ${site.live}${site.statusCode ? ` (${site.statusCode})` : ''} · streak ${site.failureStreak} · provider errors ${site.providerErrors ?? 'n/a'}`);
}
console.log(`Last run ${snapshot.lastRun}${sendAlerts ? ' · alerts enabled' : ''}`);
