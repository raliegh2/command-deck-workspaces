import {describe,it,expect} from 'vitest';
import {evaluateTradingContext,observeEvents,tradingSettingsSchema,type TradingFeed} from './trading-intelligence.js';
const now='2026-10-23T12:00:00Z';
const event={id:'e1',sourceId:'federal-reserve-fomc' as const,sourceName:'Fed',title:'Statement',url:'https://www.federalreserve.gov/release',publishedAt:'2026-10-23T11:00:00Z',currencies:['USD' as const],category:'monetary-policy' as const,impact:'high' as const};
function feed():TradingFeed{return {schemaVersion:'2.0',mode:'shadow-risk-context',brokerExecution:false,generatedAt:now,settings:{symbols:['GBPUSD','GBPJPY'],maxAgeMinutes:180,postReleaseHours:24,automatic:false},sources:[{id:'federal-reserve-fomc',name:'Fed',host:'federalreserve.gov',status:'ready',documents:1,detail:''},{id:'bank-of-england-mpc',name:'BoE',host:'bankofengland.co.uk',status:'ready',documents:1,detail:''}],events:observeEvents([event],null,now),reviewSignals:{eligibleForForex:false,reason:'Unvalidated'}};}
describe('trading risk context',()=>{
 it('fails closed for missing, stale, future or incomplete feed',()=>{
  expect(evaluateTradingContext(null,'GBPUSD',new Date(now)).riskMultiplier).toBe(0);
  expect(evaluateTradingContext(feed(),'GBPUSD',new Date('2026-10-24T12:00:00Z')).riskMultiplier).toBe(0);
  expect(evaluateTradingContext(feed(),'GBPUSD',new Date('2026-10-23T11:59:59Z')).riskMultiplier).toBe(0);
  const f=feed();f.sources[0]!.status='error';expect(evaluateTradingContext(f,'GBPUSD',new Date(now)).riskMultiplier).toBe(0);
 });
 it('reduces only exposed currencies and never raises base risk',()=>{
  expect(evaluateTradingContext(feed(),'GBPUSD',new Date(now)).riskMultiplier).toBe(.5);
  expect(evaluateTradingContext(feed(),'GBPJPY',new Date(now)).riskMultiplier).toBe(1);
  expect(evaluateTradingContext(feed(),'EURUSD',new Date(now)).riskMultiplier).toBe(0);
 });
 it('preserves first observations across refreshes and ignores future knowledge',()=>{
  const f=feed();const later='2026-10-23T13:00:00Z';expect(observeEvents([event],f,later)[0]!.firstSeenAt).toBe(now);
  f.events[0]!.availableAt=later;expect(evaluateTradingContext(f,'GBPUSD',new Date(now)).riskMultiplier).toBe(1);
 });
 it('rejects unsupported universe and unbounded expiry',()=>{
  expect(()=>tradingSettingsSchema.parse({symbols:['LOGI'],maxAgeMinutes:180,postReleaseHours:24})).toThrow();
  expect(()=>tradingSettingsSchema.parse({symbols:['GBPUSD'],maxAgeMinutes:0,postReleaseHours:24})).toThrow();
 });
});
