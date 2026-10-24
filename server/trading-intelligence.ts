import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {crawlOfficialMarketSources,getMarketIntelligenceView,type MarketIntelligenceEvent} from './market-intelligence.js';
import {projectById} from './projects.js';
import {dataDir} from './store.js';
import {PublicError} from './errors.js';

export const tradingSettingsSchema=z.object({symbols:z.array(z.enum(['GBPUSD','GBPJPY','EURUSD','AUDUSD','USDJPY','USDCHF','USDCAD','XAUUSD'])).min(1).max(8).transform(a=>[...new Set(a)]),maxAgeMinutes:z.number().int().min(15).max(1440),postReleaseHours:z.number().int().min(1).max(72),automatic:z.boolean().default(false)}).strict();
type Settings=z.infer<typeof tradingSettingsSchema>;
type ObservedEvent=MarketIntelligenceEvent&{firstSeenAt:string;availableAt:string};
export type TradingFeed={schemaVersion:'2.0';mode:'shadow-risk-context';brokerExecution:false;generatedAt:string;settings:Settings;sources:Awaited<ReturnType<typeof crawlOfficialMarketSources>>['sources'];events:ObservedEvent[];reviewSignals:{eligibleForForex:false;reason:string}};
const folder=path.join(dataDir,'trading-intelligence');
const defaults:Settings={symbols:['GBPUSD','GBPJPY'],maxAgeMinutes:180,postReleaseHours:24,automatic:false};
async function read<T>(p:string,fallback:T):Promise<T>{return JSON.parse(await fs.readFile(p,'utf8').catch(()=>JSON.stringify(fallback))) as T;}
async function write(p:string,value:unknown){await fs.mkdir(path.dirname(p),{recursive:true});const tmp=p+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,p);}
export function evaluateTradingContext(feed:TradingFeed|null,symbol:string,asOf=new Date()){
 const blocked=(reason:string)=>({symbol,asOf:asOf.toISOString(),action:'block-new-entries' as const,riskMultiplier:0,reasons:[reason],eventIds:[] as string[],brokerExecution:false});
 if(!feed)return blocked('No observed trading feed.');
 if(!feed.settings.symbols.some(s=>s===symbol))return blocked('Symbol is outside the selected universe.');
 const now=asOf.getTime(),generated=Date.parse(feed.generatedAt);
 if(!Number.isFinite(generated)||generated>now||now-generated>feed.settings.maxAgeMinutes*60000)return blocked('Trading feed is stale or has a future timestamp.');
 const currencies=[symbol.slice(0,3),symbol.slice(3,6)];
 const needed=currencies.filter(c=>c==='USD'||c==='GBP');
 if(!needed.length||needed.some(c=>!feed.sources.some(s=>s.status==='ready'&&(c==='USD'?s.id==='federal-reserve-fomc':s.id==='bank-of-england-mpc'))))return blocked('Required official source coverage is incomplete.');
 if(feed.events.some(e=>![e.publishedAt,e.firstSeenAt,e.availableAt].every(t=>Number.isFinite(Date.parse(t)))||Date.parse(e.availableAt)<Math.max(Date.parse(e.publishedAt),Date.parse(e.firstSeenAt))))return blocked('Invalid event availability provenance.');
 const active=feed.events.filter(e=>e.currencies.some(c=>currencies.includes(c))&&Date.parse(e.availableAt)<=now&&Date.parse(e.publishedAt)<=now&&now<Date.parse(e.publishedAt)+feed.settings.postReleaseHours*3600000);
 return {symbol,asOf:asOf.toISOString(),action:active.length?'reduce-risk':'no-additional-restriction',riskMultiplier:active.length?0.5:1,reasons:active.length?['Observed monetary-policy release inside the configured post-release window.']:['No observed release window; strategy and account risk controls still apply.'],eventIds:active.map(e=>e.id),brokerExecution:false};
}
export function observeEvents(events:MarketIntelligenceEvent[],previous:TradingFeed|null,now:string):ObservedEvent[]{
 const seen=new Map(previous?.events.map(e=>[e.id,e.firstSeenAt])??[]);
 return events.map(e=>{const firstSeenAt=seen.get(e.id)??now;return {...e,firstSeenAt,availableAt:new Date(Math.max(Date.parse(firstSeenAt),Date.parse(e.publishedAt))).toISOString()};});
}
async function projectRoot(){const p=await projectById('m5-v15-research');if(!p?.root)throw new PublicError('Trading research workspace is not registered.');return p.root;}
export async function tradingIntelligenceStatus(){
 const settings=await read<Settings>(path.join(folder,'settings.json'),defaults);const feed=await read<TradingFeed|null>(path.join(folder,'feed.json'),null);const market=await getMarketIntelligenceView();
 const root=await projectRoot();const forward=await read<{costs_verified?:boolean}>(path.join(root,'config/v15_forward.json'),{});
 const review=await read<{metrics?:{reviews?:number;eligible_signals?:number}}>(path.resolve('public/review-signals/status.json'),{});
 const csv=await fs.readFile(path.join(root,'GBPUSD_M5.csv'),'utf8').catch(()=>'');const lines=csv.trim().split(/\r?\n/);const columns=lines[0]?.split(',')??[];
 const stamp=(line:string|undefined)=>{const n=Number(line?.split(',')[0]);return Number.isFinite(n)&&n>0?new Date(n*1000).toISOString():null;};
 const dataQuality={file:'GBPUSD_M5.csv',rows:Math.max(0,lines.length-1),from:stamp(lines[1]),to:stamp(lines.at(-1)),sha256:csv?crypto.createHash('sha256').update(csv).digest('hex'):null,hasSpread:columns.includes('spread'),hasRealTicks:false};
 return {settings,feed,contexts:settings.symbols.map(symbol=>evaluateTradingContext(feed,symbol)),reviewEvidence:{records:review.metrics?.reviews??0,eligibleSignals:review.metrics?.eligible_signals??0,forexEligible:false},diagnostics:{dataQuality,brokerCostsVerified:forward.costs_verified===true,latestBacktest:market.latestBacktest,findings:[...(!forward.costs_verified?['Broker commission, swap and slippage remain unverified.']:[]),...(!dataQuality.hasSpread?['Historical CSV has no spread column: replay uses a fixed spread assumption.']:[]),...(market.latestBacktest?.blockedEntries===0?['Latest crawler comparison changed zero entries; it does not validate this feature.']:[]),'Current demo execution version and trade ledger must be matched to the frozen strategy before attributing losses.','Observed feed timestamps prevent using newly scraped historical pages as previously known information.'],nextChecks:['Reproduce the exact baseline and input hashes.','Separate development, chronological holdout and prospective demo results.','Compare broker costs, timestamps, fills and exit decisions against replay.']},feedPath:'research/command_deck_trading_intelligence/feed.json',brokerExecution:false};
}
export function startTradingIntelligence(){
 const tick=async()=>{const settings=await read<Settings>(path.join(folder,'settings.json'),defaults);if(!settings.automatic||crawling)return;await refreshTradingIntelligence(settings);};
 const timer=setInterval(()=>void tick().catch(()=>console.warn('Trading source refresh unavailable; freshness gates remain active.')),15*60000);timer.unref();
 void tick().catch(()=>console.warn('Trading source refresh unavailable; freshness gates remain active.'));
}
let crawling=false;
export async function refreshTradingIntelligence(input:unknown){
 const settings=tradingSettingsSchema.parse(input);if(crawling)throw new PublicError('Trading crawler is already running.',409);crawling=true;
 try{
 const now=new Date();const {events,sources}=await crawlOfficialMarketSources(now);const previous=await read<TradingFeed|null>(path.join(folder,'feed.json'),null);
 // Preserve first observation times. Failed refreshes cannot present an old feed as fresh.
 const feed:TradingFeed={schemaVersion:'2.0',mode:'shadow-risk-context',brokerExecution:false,generatedAt:now.toISOString(),settings,sources,events:observeEvents(events,previous,now.toISOString()),reviewSignals:{eligibleForForex:false,reason:'Product review/revenue correlations have no validated mapping to these FX symbols.'}};
 const root=await projectRoot();await write(path.join(root,'research/command_deck_trading_intelligence/feed.json'),feed);await write(path.join(folder,'feed.json'),feed);await write(path.join(folder,'settings.json'),settings);
 return tradingIntelligenceStatus();
 }finally{crawling=false;}
}
