import {describe,expect,it,vi} from 'vitest';
import {dependencyAuditCounts} from './production.js';
vi.mock('./operations/store.js',()=>({readOperationsSnapshot:async()=>({lastRun:null,sites:[{id:'example-care',live:'online',statusCode:200,providerErrors:99,providerErrorClasses:{legacy:99},failureStreak:0,checkedAt:'2026-10-19T00:00:00Z'}]})}));
const zero={critical:0,high:0,moderate:0,low:0,info:0,total:0};
describe('production security evidence',()=>{
 it('does not misattribute legacy connector errors or credentials to Cloudflare production',async()=>{
  const previous=process.env.VERCEL_TOKEN;process.env.VERCEL_TOKEN='synthetic-token-that-must-not-imply-a-cloudflare-connector';
  try{const {getOperationsView}=await import('./operations/index.js');const view=await getOperationsView();const site=view.sites.find(s=>s.id==='example-care')!;expect(site.provider).toMatchObject({kind:'cloudflare-workers',connectorConfigured:false});expect(site.monitor.providerErrors).toBeNull();expect(site.monitor.providerErrorClasses).toEqual({});expect(site.supabase.status).toBe('not-used');expect(view.connectors.cloudflare.status).toBe('needs-configuration');}finally{if(previous===undefined)delete process.env.VERCEL_TOKEN;else process.env.VERCEL_TOKEN=previous;}
 });
 it('accepts complete clean reports and known findings despite npm exit one',()=>{expect(dependencyAuditCounts({metadata:{vulnerabilities:zero}},0).total).toBe(0);expect(dependencyAuditCounts({metadata:{vulnerabilities:{...zero,high:1,total:1}}},1).high).toBe(1);});
 it('never interprets an error or partial report as clean',()=>{expect(()=>dependencyAuditCounts({error:{code:'ENETWORK'}},1)).toThrow();expect(()=>dependencyAuditCounts({metadata:{vulnerabilities:{}}},0)).toThrow();expect(()=>dependencyAuditCounts({metadata:{vulnerabilities:zero}},2)).toThrow();});
 it('rejects inconsistent totals and invalid counts',()=>{expect(()=>dependencyAuditCounts({metadata:{vulnerabilities:{...zero,high:1}}},0)).toThrow();expect(()=>dependencyAuditCounts({metadata:{vulnerabilities:{...zero,high:-1,total:-1}}},1)).toThrow();});
});
