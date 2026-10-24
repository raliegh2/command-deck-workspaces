import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: http.Server;
let port = 0;
let dataDir = '';

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-app-'));
  process.env.COMMAND_DECK_DATA_DIR = dataDir;
  process.env.COMMAND_DECK_WORKSPACE_ROOTS = dataDir;
  const { createApp, useErrorHandler } = await import('./app.js');
  const { initStore } = await import('./store.js');
  await initStore();
  // The guard needs the real port, so bind first and then attach the app.
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  const app = createApp(port);
  useErrorHandler(app);
  server.on('request', app);
});

afterAll(async () => {
  (await import('./neural-memory.js')).closeNeuralMemory();
  (await import('./local-runtime.js')).closeLocalRuntime();
  await new Promise((resolve) => server.close(resolve));
  await (await import('./security-program.js')).closeSecurityProgram();
  await fs.rm(dataDir, { recursive: true, force: true });
});

function call(pathname: string, options: { method?: string; headers?: Record<string, string>; body?: unknown;rawBody?:string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }>((resolve, reject) => {
    const payload = options.rawBody??(options.body === undefined ? undefined : JSON.stringify(options.body));
    const request = http.request({
      host: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET',
      headers: { host: `127.0.0.1:${port}`, ...(payload ? { 'content-type': 'application/json' } : {}), ...options.headers },
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function token() {
  const response = await call('/api/session', { headers: { 'sec-fetch-site': 'same-origin' } });
  return response.body.token as string;
}

describe('API boundary', () => {
  it('rejects malformed and oversized JSON without reflecting request content',async()=>{
    const headers={authorization:'Bearer '+await token()};
    const malformed=await call('/api/dispatch',{method:'POST',headers,rawBody:'{"password":"synthetic-private-value",broken}'});expect(malformed.status).toBe(400);expect(JSON.stringify(malformed.body)).not.toContain('synthetic-private-value');
    const oversized=await call('/api/dispatch',{method:'POST',headers,body:{data:'x'.repeat(1048576)}});expect(oversized.status).toBe(413);expect(oversized.headers['cache-control']).toBe('no-store');
  });
  it('protects security evidence, records redacted metadata and keeps synthetic labs separate',async()=>{
    expect((await call('/api/security/program')).status).toBe(401);
    const headers={authorization:'Bearer '+await token()};
    const labs=await call('/api/security/labs',{method:'POST',headers,body:{}});expect(labs.status).toBe(200);expect(labs.body.results).toHaveLength(14);expect(labs.body.results.every((r:any)=>r.passed)).toBe(true);
    const evidence=await call('/api/security/evidence',{method:'POST',headers,body:{projectId:'command-deck',practiceId:'log-analysis',owner:'Security responder',summary:'Verified synthetic-only telemetry; production validation is still pending.',reference:'fixture:security-boundary',observedAt:new Date().toISOString()}});expect(evidence.status).toBe(201);expect(evidence.body.status).toBe('pending');
    await call('/api/nope?token=never-store-this',{headers:{authorization:'Bearer invalid-do-not-store'}});
    const program=await call('/api/security/program',{headers});expect(program.status).toBe(200);expect(program.body.practices).toHaveLength(14);expect(program.body.integrity.valid).toBe(true);expect(JSON.stringify(program.body.events)).not.toMatch(/never-store-this|invalid-do-not-store/);
    expect(program.body.projects.find((p:any)=>p.projectId==='command-deck').controls.every((c:any)=>c.status==='not-assessed')).toBe(true);
    expect((await call('/api/security/evidence/'+evidence.body.id+'/review',{method:'POST',headers,body:{decision:'reject'}})).status).toBe(200);
  });
  it('authenticates and validates RAG/CAG routes and returns scoped context',async()=>{
    expect((await call('/api/memory/answer',{method:'POST',body:{query:'Explain the system'}})).status).toBe(401);
    const headers={authorization:'Bearer '+await token()};
    expect((await call('/api/memory/context',{method:'POST',headers,body:{query:'Explain',mode:'bad'}})).status).toBe(400);
    const context=await call('/api/memory/context',{method:'POST',headers,body:{query:'Explain',projectId:'missing-project',mode:'cag'}});
    expect(context.status).toBe(200);expect(context.body).toMatchObject({mode:'cag',sources:[],untrusted:true,cache:{hit:false}});
    const answer=await call('/api/memory/answer',{method:'POST',headers,body:{query:'Explain',projectId:'missing-project',mode:'cag'}});
    expect(answer.body).toMatchObject({abstained:true,citations:[],cache:{hit:true}});
  });
  it('protects private memory and quarantines lessons until owner review',async()=>{
    expect((await call('/api/memory/status')).status).toBe(401);
    const headers={authorization:'Bearer '+await token()};
    const created=await call('/api/memory/lessons',{method:'POST',headers,body:{projectId:'command-deck',title:'Evidence-led restart',text:'Restart the service and verify the specific health route before declaring recovery.',evidence:['run-test-memory-001']}});
    expect(created.status).toBe(201);expect(created.body.searchable).toBe(false);
    const before=await call('/api/memory/search?q=Evidence-led',{headers});expect(before.body.results).toHaveLength(0);
    expect((await call('/api/memory/lessons/'+created.body.id+'/review',{method:'POST',headers,body:{decision:'approve'}})).status).toBe(200);
    const after=await call('/api/memory/search?q=Restart',{headers});expect(after.body.results[0]).toMatchObject({source:'agent',untrusted:true});
    const invalid=await call('/api/memory/notion-snapshot',{method:'POST',headers,body:{capturedAt:new Date().toISOString(),complete:true,documents:[{id:'notion:'+'a'.repeat(32),source:'notion',title:'bad',locator:'https://evil.example/page',text:'untrusted',updatedAt:new Date().toISOString()}]}});expect(invalid.status).toBe(400);
  });
  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const response = await call('/api/projects/northstar/files', { headers: { host: `evil.example:${port}` } });
    expect(response.status).toBe(421);
  });

  it('rejects API calls without the session token', async () => {
    expect((await call('/api/dashboard')).status).toBe(401);
    expect((await call('/api/production-alerts')).status).toBe(401);
    expect((await call('/api/projects/northstar/files')).status).toBe(401);
    expect((await call('/api/changesets/x/apply', { method: 'POST', body: { confirmation: 'APPLY' } })).status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect((await call('/api/dashboard', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('issues the session token only to same-origin browser requests', async () => {
    expect((await call('/api/session')).status).toBe(403);
    expect((await call('/api/session', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect(await token()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects foreign origins even with a valid token', async () => {
    const response = await call('/api/dispatch', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + await token(), origin: 'https://evil.example' },
      body: { prompt: 'do something' },
    });
    expect(response.status).toBe(403);
  });

  it('sends browser security headers', async () => {
    const response = await call('/api/health');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('keeps the health check free of local paths', async () => {
    expect(JSON.stringify((await call('/api/health')).body)).not.toMatch(/[A-Z]:[\\/]/);
  });

  it('refuses to register folders outside the approved workspace roots', async () => {
    const response = await call('/api/projects', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + await token() },
      body: { id: 'probe', name: 'Probe', root: os.homedir() },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('approved workspace');
  });

  it('refuses credential folders even inside an approved root', async () => {
    const secretDir = path.join(dataDir, '.ssh');
    await fs.mkdir(secretDir, { recursive: true });
    const response = await call('/api/projects', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + await token() },
      body: { id: 'probe', name: 'Probe', root: secretDir },
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('credential');
  });

  it('returns a 404 for unknown API routes instead of the web app', async () => {
    expect((await call('/api/nope', { headers: { authorization: 'Bearer ' + await token() } })).status).toBe(404);
  });

  it('rate-limits quota-spending actions per key', async () => {
    const { cooldown } = await import('./security.js');
    const limit = cooldown(30_000);
    expect(limit('run')).toBe(0);
    expect(limit('run')).toBeGreaterThan(0);
    expect(limit('other')).toBe(0);
  });
  it('throttles invalid tokens while preserving valid-session access and no-store responses',async()=>{
    let status=0;for(let i=0;i<25;i++)status=(await call('/api/capabilities',{headers:{authorization:'Bearer invalid'}})).status;
    expect(status).toBe(429);const result=await call('/api/capabilities',{headers:{authorization:'Bearer '+await token()}});expect(result.status).toBe(200);expect(result.headers['cache-control']).toBe('no-store');expect(result.headers['permissions-policy']).toContain('camera=()');
  });
});

describe('workspace integration boundary',()=>{
 it('authenticates uploads, validates content and stores a readable safe document record',async()=>{
  expect([401,429]).toContain((await call('/api/workspace/documents')).status);
  const headers={authorization:'Bearer '+await token(),'content-type':'application/octet-stream'};
  const bad=await call('/api/workspace/documents?name=renamed.pdf',{method:'POST',headers,rawBody:'MZ executable'});expect(bad.status).toBe(400);
  const good=await call('/api/workspace/documents?name=verification.pdf',{method:'POST',headers,rawBody:'%PDF-1.7 synthetic upload boundary fixture'});expect(good.status).toBe(201);expect(good.body.name).toBe('verification.pdf');expect(good.body.status).toBe('uploaded');expect(good.body).not.toHaveProperty('filename');
  const list=await call('/api/workspace/documents',{headers});expect(list.body.documents.some((d:any)=>d.id===good.body.id)).toBe(true);
  expect((await call('/api/workspace/documents/not-an-id/process',{method:'POST',headers:{authorization:headers.authorization},body:{}})).status).toBe(400);
 });
 it('rejects invalid task states and unknown tasks without touching requests',async()=>{const headers={authorization:'Bearer '+await token()};expect((await call('/api/workspace/tasks/missing',{method:'PATCH',headers,body:{status:'complete'}})).status).toBe(404);expect((await call('/api/workspace/tasks/missing',{method:'PATCH',headers,body:{status:'deployed'}})).status).toBe(400);});
});


