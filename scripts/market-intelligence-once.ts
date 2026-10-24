import { crawlMarketIntelligence, getMarketIntelligenceView, runMarketIntelligenceBacktest } from '../server/market-intelligence.js';

const args = new Set(process.argv.slice(2));
const crawlOnly = args.has('--crawl-only');
const backtestOnly = args.has('--backtest-only');
if (crawlOnly && backtestOnly) throw new Error('Choose either --crawl-only or --backtest-only.');

const afterCrawl = backtestOnly ? await getMarketIntelligenceView() : await crawlMarketIntelligence();
const result = crawlOnly ? afterCrawl : await runMarketIntelligenceBacktest();
console.log(JSON.stringify({
  status: result.status,
  crawledAt: result.crawledAt,
  eventCount: result.eventCount,
  sourceStatus: result.sources.map((source) => ({ id: source.id, status: source.status, documents: source.documents })),
  latestBacktest: result.latestBacktest,
}, null, 2));
