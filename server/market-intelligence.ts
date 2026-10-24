import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PublicError } from './errors.js';
import { runProcess, sanitizedEnv } from './processes.js';
import { projectById } from './projects.js';
import { dataDir } from './store.js';

const projectId = 'm5-v15-research';
const featureDirectory = 'research/command_deck_market_intelligence';
const feedName = 'crawler-feed.json';
const statePath = path.join(dataDir, 'market-intelligence.json');
const postReleaseGateHours = 24;
const maxResponseBytes = 2_000_000;
const trustedHosts = new Set(['www.federalreserve.gov', 'federalreserve.gov', 'www.bankofengland.co.uk', 'bankofengland.co.uk']);

export type MarketSourceStatus = 'ready' | 'partial' | 'error' | 'not-run';

export interface MarketIntelligenceEvent {
  id: string;
  sourceId: 'federal-reserve-fomc' | 'bank-of-england-mpc';
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string;
  currencies: Array<'USD' | 'GBP'>;
  category: 'monetary-policy';
  impact: 'high';
}

export interface MarketSourceView {
  id: MarketIntelligenceEvent['sourceId'];
  name: string;
  host: string;
  status: MarketSourceStatus;
  documents: number;
  detail: string;
}

export interface MarketBacktestView {
  ranAt: string;
  verdict: 'INCONCLUSIVE_LOW_SAMPLE' | 'FEATURE_EFFECTIVE_IN_SAMPLE' | 'FEATURE_NOT_EFFECTIVE_IN_SAMPLE';
  evidenceGrade: 'insufficient' | 'research-only';
  baseline: { closedTrades: number; netR: number; netPnl: number; profitFactor: number | null; maxDrawdownPct: number };
  feature: { closedTrades: number; netR: number; netPnl: number; profitFactor: number | null; maxDrawdownPct: number };
  delta: { closedTrades: number; netR: number; netPnl: number; maxDrawdownPct: number };
  blockedEntries: number;
  eventsInRange: number;
  improvedPartitions: number;
  reportPath: string;
  note: string;
}

export interface MarketIntelligenceView {
  schemaVersion: '1.0';
  mode: 'offline-research-only';
  execution: 'local-enabled';
  status: 'idle' | 'ready' | 'partial' | 'error';
  crawledAt: string | null;
  eventCount: number;
  feedSha256: string | null;
  feedPath: string;
  gatePolicy: { kind: 'post-release-risk-window'; hours: number; causal: true; automaticPromotion: false };
  sources: MarketSourceView[];
  recentEvents: MarketIntelligenceEvent[];
  latestBacktest: MarketBacktestView | null;
}

const sourceDefaults: MarketSourceView[] = [
  { id: 'federal-reserve-fomc', name: 'Federal Reserve FOMC releases', host: 'federalreserve.gov', status: 'not-run', documents: 0, detail: 'Official annual FOMC release indexes.' },
  { id: 'bank-of-england-mpc', name: 'Bank of England MPC releases', host: 'bankofengland.co.uk', status: 'not-run', documents: 0, detail: 'Official monetary-policy minutes sitemap.' },
];

const eventSchema = z.object({
  id: z.string(), sourceId: z.enum(['federal-reserve-fomc', 'bank-of-england-mpc']), sourceName: z.string(),
  title: z.string(), url: z.string().url(), publishedAt: z.string().datetime(), currencies: z.array(z.enum(['USD', 'GBP'])),
  category: z.literal('monetary-policy'), impact: z.literal('high'),
});

const backtestSchema = z.object({
  ran_at: z.string().datetime(),
  verdict: z.enum(['INCONCLUSIVE_LOW_SAMPLE', 'FEATURE_EFFECTIVE_IN_SAMPLE', 'FEATURE_NOT_EFFECTIVE_IN_SAMPLE']),
  evidence_grade: z.enum(['insufficient', 'research-only']),
  baseline: z.object({ closed_trades: z.number(), net_r: z.number(), net_pnl: z.number(), profit_factor: z.number().nullable(), max_drawdown_pct: z.number() }),
  feature: z.object({ closed_trades: z.number(), net_r: z.number(), net_pnl: z.number(), profit_factor: z.number().nullable(), max_drawdown_pct: z.number() }),
  delta: z.object({ closed_trades: z.number(), net_r: z.number(), net_pnl: z.number(), max_drawdown_pct: z.number() }),
  blocked_entries: z.number(), events_in_range: z.number(), improved_partitions: z.number(), report_path: z.string(), note: z.string(),
});

function emptyView(): MarketIntelligenceView {
  return {
    schemaVersion: '1.0', mode: 'offline-research-only', execution: 'local-enabled', status: 'idle', crawledAt: null, eventCount: 0,
    feedSha256: null, feedPath: `${featureDirectory}/${feedName}`,
    gatePolicy: { kind: 'post-release-risk-window', hours: postReleaseGateHours, causal: true, automaticPromotion: false },
    sources: structuredClone(sourceDefaults), recentEvents: [], latestBacktest: null,
  };
}

export async function getMarketIntelligenceView(): Promise<MarketIntelligenceView> {
  const text = await fs.readFile(statePath, 'utf8').catch(() => '');
  if (!text) return emptyView();
  try {
    const parsed = JSON.parse(text) as MarketIntelligenceView;
    return parsed.schemaVersion === '1.0' ? { ...parsed, execution: 'local-enabled' } : emptyView();
  } catch {
    return { ...emptyView(), status: 'error' };
  }
}

function decodeHtml(value: string) {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match);
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180);
}

function absoluteUrl(base: string, href: string) {
  return new URL(href, base).toString().split('#')[0]!;
}

function assertTrustedUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !trustedHosts.has(url.hostname.toLowerCase())) throw new PublicError('Crawler source is not allowlisted.');
  return url;
}

async function fetchText(input: string, fetcher: typeof fetch, redirects = 0): Promise<string> {
  const url = assertTrustedUrl(input);
  const response = await fetcher(url, {
    redirect: 'manual', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9', 'User-Agent': 'CommandDeckMarketResearch/1.0 (local offline research)' },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || redirects >= 2) throw new PublicError('Crawler source redirected unexpectedly.');
    return fetchText(absoluteUrl(url.toString(), location), fetcher, redirects + 1);
  }
  if (!response.ok) throw new PublicError(`Official source returned HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > maxResponseBytes) throw new PublicError('Crawler source exceeded the response-size limit.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new PublicError('Crawler source exceeded the response-size limit.');
  return text;
}

function monthIndex(name: string) {
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  return months.indexOf(name.toLowerCase());
}

function lastSunday(year: number, month: number) {
  const date = new Date(Date.UTC(year, month + 1, 0));
  return date.getUTCDate() - date.getUTCDay();
}

function londonNoonUtc(year: number, month: number, day: number) {
  const dst = (month > 2 && month < 9)
    || (month === 2 && day >= lastSunday(year, 2))
    || (month === 9 && day < lastSunday(year, 9));
  return new Date(Date.UTC(year, month, day, dst ? 11 : 12)).toISOString();
}

export function parseFedIndex(html: string, baseUrl: string) {
  const links: Array<{ url: string; title: string }> = [];
  const regex = /<a\b[^>]*href=["']([^"']*\/newsevents\/pressreleases\/monetary\d{8}[a-z]\.htm)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const title = plainText(match[2] ?? '');
    if (/FOMC statement/i.test(title)) links.push({ url: absoluteUrl(baseUrl, match[1]!), title });
  }
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

export function parseFedRelease(html: string, url: string, fallbackTitle: string): MarketIntelligenceEvent | null {
  const dateMatch = url.match(/monetary(\d{4})(\d{2})(\d{2})[a-z]\.htm/i);
  const timeMatch = html.match(/For release at\s*(\d{1,2}):(\d{2})\s*(a\.m\.|p\.m\.)\s*(EST|EDT)/i);
  if (!dateMatch || !timeMatch) return null;
  let hour = Number(timeMatch[1]);
  if (/p\.m\./i.test(timeMatch[3]!) && hour !== 12) hour += 12;
  if (/a\.m\./i.test(timeMatch[3]!) && hour === 12) hour = 0;
  const offsetHours = timeMatch[4]!.toUpperCase() === 'EDT' ? 4 : 5;
  const publishedAt = new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour + offsetHours, Number(timeMatch[2]))).toISOString();
  return {
    id: 'fed-' + dateMatch.slice(1, 4).join(''), sourceId: 'federal-reserve-fomc', sourceName: 'Federal Reserve FOMC',
    title: fallbackTitle || 'Federal Reserve issues FOMC statement', url, publishedAt, currencies: ['USD'], category: 'monetary-policy', impact: 'high',
  };
}

export function parseBoeSitemap(html: string, baseUrl: string, years: Set<number>) {
  const links: Array<{ url: string; title: string }> = [];
  const regex = /<a\b[^>]*href=["']([^"']*\/monetary-policy-summary-and-minutes\/(\d{4})\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    if (!years.has(Number(match[2]))) continue;
    const url = absoluteUrl(baseUrl, match[1]!);
    links.push({ url, title: plainText(match[3] ?? '') });
  }
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

export function parseBoeRelease(html: string, url: string, fallbackTitle: string): MarketIntelligenceEvent | null {
  const jsonDate = html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1];
  const published = html.match(/Published on\s*(?:<[^>]+>\s*)*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
  let publishedAt = '';
  if (jsonDate) {
    const parsed = new Date(jsonDate);
    if (!Number.isNaN(parsed.getTime())) publishedAt = parsed.toISOString();
  }
  if (!publishedAt && published) {
    const month = monthIndex(published[2]!);
    if (month < 0) return null;
    publishedAt = londonNoonUtc(Number(published[3]), month, Number(published[1]));
  }
  if (!publishedAt) return null;
  const title = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? fallbackTitle) || fallbackTitle;
  const dateId = publishedAt.slice(0, 10).replaceAll('-', '');
  return { id: 'boe-' + dateId, sourceId: 'bank-of-england-mpc', sourceName: 'Bank of England MPC', title, url, publishedAt, currencies: ['GBP'], category: 'monetary-policy', impact: 'high' };
}

async function mapLimited<T, U>(items: T[], limit: number, worker: (item: T) => Promise<U>): Promise<U[]> {
  const output = new Array<U>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

export async function crawlOfficialMarketSources(now = new Date(), fetcher: typeof fetch = fetch) {
  const years = new Set([now.getUTCFullYear() - 1, now.getUTCFullYear()]);
  const events: MarketIntelligenceEvent[] = [];
  const sources = structuredClone(sourceDefaults);

  const fed = sources[0]!;
  try {
    const indexes = await Promise.all([...years].map(async (year) => {
      const url = `https://www.federalreserve.gov/newsevents/pressreleases/${year}-press-fomc.htm`;
      return parseFedIndex(await fetchText(url, fetcher), url);
    }));
    const links = [...new Map(indexes.flat().map((item) => [item.url, item])).values()];
    const rows = await mapLimited(links, 3, async (item) => parseFedRelease(await fetchText(item.url, fetcher), item.url, item.title));
    events.push(...rows.filter((item): item is MarketIntelligenceEvent => Boolean(item)));
    fed.documents = rows.filter(Boolean).length;
    fed.status = fed.documents ? 'ready' : 'partial';
    fed.detail = fed.documents ? 'Official statement timestamps captured.' : 'Indexes loaded, but no release timestamps were parsed.';
  } catch (error) {
    fed.status = 'error';
    fed.detail = error instanceof Error ? error.message.slice(0, 160) : 'Official source could not be read.';
  }

  const boe = sources[1]!;
  try {
    const sitemap = 'https://www.bankofengland.co.uk/sitemap/minutes';
    const links = parseBoeSitemap(await fetchText(sitemap, fetcher), sitemap, years);
    const rows = await mapLimited(links, 3, async (item) => parseBoeRelease(await fetchText(item.url, fetcher), item.url, item.title));
    events.push(...rows.filter((item): item is MarketIntelligenceEvent => Boolean(item)));
    boe.documents = rows.filter(Boolean).length;
    boe.status = boe.documents ? 'ready' : 'partial';
    boe.detail = boe.documents ? 'Official publication timestamps captured.' : 'Sitemap loaded, but no publication timestamps were parsed.';
  } catch (error) {
    boe.status = 'error';
    boe.detail = error instanceof Error ? error.message.slice(0, 160) : 'Official source could not be read.';
  }

  const unique = [...new Map(events.filter((event) => new Date(event.publishedAt) <= now).map((event) => [event.id, eventSchema.parse(event)])).values()]
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
  return { events: unique, sources };
}

async function atomicWrite(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, file);
}

function sha256(content: string | Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function tradingProjectRoot() {
  const project = await projectById(projectId);
  if (!project?.root) throw new PublicError('Improved Trading Bot V15 is not registered with a local workspace.');
  const stat = await fs.stat(project.root).catch(() => null);
  if (!stat?.isDirectory()) throw new PublicError('Improved Trading Bot V15 workspace is unavailable.');
  return project.root;
}

export async function crawlMarketIntelligence(fetcher: typeof fetch = fetch): Promise<MarketIntelligenceView> {
  const now = new Date();
  const previous = await getMarketIntelligenceView();
  const { events, sources } = await crawlOfficialMarketSources(now, fetcher);
  if (!events.length) throw new PublicError('No official market-intelligence events were captured. Existing feed was preserved.', 502);
  const root = await tradingProjectRoot();
  const feedPath = path.join(root, featureDirectory, feedName);
  const feed = {
    schema_version: '1.0', generated_at: now.toISOString(), mode: 'offline-research-only', broker_execution: false,
    storage: 'metadata-only', gate_policy: { kind: 'post-release-risk-window', hours: postReleaseGateHours, causal: true, automatic_promotion: false },
    allowlisted_hosts: [...trustedHosts].sort(), events,
  };
  const content = JSON.stringify(feed, null, 2) + '\n';
  await atomicWrite(feedPath, content);
  const readyCount = sources.filter((source) => source.status === 'ready').length;
  const view: MarketIntelligenceView = {
    ...previous, status: readyCount === sources.length ? 'ready' : readyCount ? 'partial' : 'error',
    crawledAt: now.toISOString(), eventCount: events.length, feedSha256: sha256(content), sources,
    recentEvents: [...events].reverse().slice(0, 8),
  };
  await atomicWrite(statePath, JSON.stringify(view, null, 2) + '\n');
  return view;
}

function pythonCommand(): [string, string[]] {
  if (process.env.COMMAND_DECK_PYTHON) return [process.env.COMMAND_DECK_PYTHON, []];
  return process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
}

function compactRunId(date = new Date()) {
  return date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

export async function runMarketIntelligenceBacktest(): Promise<MarketIntelligenceView> {
  const root = await tradingProjectRoot();
  const feedPath = path.join(root, featureDirectory, feedName);
  const feedStat = await fs.stat(feedPath).catch(() => null);
  if (!feedStat?.isFile()) throw new PublicError('Run the market crawler before starting the feature backtest.');
  const script = path.join(root, 'research', 'market_intelligence_backtest.py');
  const csv = path.join(root, 'GBPUSD_M5.csv');
  const output = path.join(root, featureDirectory, 'backtests', 'run-' + compactRunId());
  if (!(await fs.stat(script).catch(() => null))?.isFile()) throw new PublicError('The market-intelligence backtest module is missing.');
  const [python, prefix] = pythonCommand();
  const result = await runProcess(python, [...prefix, '-m', 'research.market_intelligence_backtest',
    '--csv', csv, '--feed', feedPath, '--out', output,
    '--spread', '0.00012', '--commission', '0.00007', '--swap-reserve', '0.00003', '--slippage', '0.00002'], {
    cwd: root, timeoutMs: 300_000, maxStdout: 1_000_000, env: sanitizedEnv({ PYTHONIOENCODING: 'utf-8' }),
  });
  if (result.exitCode === null && !result.timedOut) throw new PublicError(`Python could not be started ("${python}"). Set COMMAND_DECK_PYTHON to a Python environment with pandas.`);
  if (result.timedOut) throw new PublicError('The market-intelligence backtest exceeded five minutes.');
  if (result.exitCode !== 0) throw new PublicError('The market-intelligence backtest failed. ' + result.outputTail.slice(-300), 500);
  let parsed: z.infer<typeof backtestSchema>;
  try { parsed = backtestSchema.parse(JSON.parse(result.stdout)); }
  catch { throw new PublicError('The market-intelligence backtest returned an unreadable summary.', 500); }
  const latestBacktest: MarketBacktestView = {
    ranAt: parsed.ran_at, verdict: parsed.verdict, evidenceGrade: parsed.evidence_grade,
    baseline: { closedTrades: parsed.baseline.closed_trades, netR: parsed.baseline.net_r, netPnl: parsed.baseline.net_pnl, profitFactor: parsed.baseline.profit_factor, maxDrawdownPct: parsed.baseline.max_drawdown_pct },
    feature: { closedTrades: parsed.feature.closed_trades, netR: parsed.feature.net_r, netPnl: parsed.feature.net_pnl, profitFactor: parsed.feature.profit_factor, maxDrawdownPct: parsed.feature.max_drawdown_pct },
    delta: { closedTrades: parsed.delta.closed_trades, netR: parsed.delta.net_r, netPnl: parsed.delta.net_pnl, maxDrawdownPct: parsed.delta.max_drawdown_pct },
    blockedEntries: parsed.blocked_entries, eventsInRange: parsed.events_in_range, improvedPartitions: parsed.improved_partitions,
    reportPath: parsed.report_path.replaceAll('\\', '/'), note: parsed.note,
  };
  const view = { ...(await getMarketIntelligenceView()), latestBacktest };
  await atomicWrite(statePath, JSON.stringify(view, null, 2) + '\n');
  return view;
}
