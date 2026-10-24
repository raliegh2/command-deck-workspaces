import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let server: http.Server;
let dataDir = '';
let client: Client;

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args }) as ToolResult;
  return { text: result.content[0]?.text ?? '', isError: Boolean(result.isError) };
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-mcp-'));
  process.env.COMMAND_DECK_DATA_DIR = dataDir;
  process.env.COMMAND_DECK_TOKEN = 'mcp-test-token-'.padEnd(48, 'x');

  // A real Command Deck API on an ephemeral loopback port.
  const { createApp, useErrorHandler } = await import('../server/app.js');
  const { initStore } = await import('../server/store.js');
  await initStore();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const app = createApp(port);
  useErrorHandler(app);
  server.on('request', app);
  process.env.COMMAND_DECK_URL = `http://127.0.0.1:${port}`;

  const { createDeckServer } = await import('./server.js');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createDeckServer().connect(serverTransport);
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  (await import('../server/neural-memory.js')).closeNeuralMemory();
  await client?.close();
  await new Promise((resolve) => server.close(resolve));
  await (await import('../server/security-program.js')).closeSecurityProgram();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('Command Deck MCP server', () => {
  it('exposes the expected tools, and no tool that applies changes', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((item) => item.name).sort();
    expect(names).toEqual([
      'answer_from_memory', 'backtest_market_intelligence', 'consult_harness', 'coordinate_harnesses', 'crawl_market_intelligence', 'deck_overview', 'dispatch_task', 'get_audit_report', 'harness_status', 'import_notion_memory', 'list_project_files', 'list_projects', 'list_work', 'local_tool_catalog', 'local_tool_job', 'local_tool_run', 'market_intelligence_status', 'memory_status', 'operations_status',
      'plan_local_task', 'prepare_memory_context', 'production_alerts', 'production_status', 'production_watch_status', 'propose_change', 'read_project_file', 'record_memory_lesson', 'record_source_review', 'refresh_memory_index', 'request_production_change', 'retrieve_memory', 'run_functional_audit',
      'run_operations_checks', 'run_production_audit', 'run_security_audit', 'run_security_labs', 'search_knowledge', 'security_program_status', 'submit_security_evidence',
    ]);
    expect(names.some((name) => /apply/.test(name))).toBe(false);
    expect(tools.find((item) => item.name === 'read_project_file')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((item) => item.name === 'coordinate_harnesses')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((item) => item.name === 'market_intelligence_status')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((item) => item.name === 'production_alerts')?.annotations?.readOnlyHint).toBe(true);
  });

  it('returns an overview through the authenticated API', async () => {
    const result = await call('deck_overview');
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toHaveProperty('projects');
    // Cold project status runs git and health probes against the real registered projects.
  }, 30_000);

  it('keeps the server path protections', async () => {
    const result = await call('read_project_file', { projectId: 'northstar', path: '.env::$DATA' });
    expect(result).toEqual({ text: 'That path is protected.', isError: true });
  });

  it('rejects malformed IDs before calling the API', async () => {
    const result = await client.callTool({ name: 'list_project_files', arguments: { projectId: '../etc' } }) as ToolResult;
    expect(result.isError).toBe(true);
  });

  it('reports API errors as readable tool errors', async () => {
    const result = await call('propose_change', { projectId: 'no-such-project', path: 'a.md', content: 'x', reason: 'test' });
    expect(result).toEqual({ text: 'Project not found.', isError: true });
  });

  it('records a source review and returns it in the audit report', async () => {
    const recorded = await call('record_source_review', {
      projectId: 'example-care',
      status: 'action-needed',
      summary: 'Reviewed the auth middleware and API routes.',
      findings: [{ severity: 'high', title: 'Missing rate limit on login', file: 'api/login.ts:12' }],
    });
    expect(recorded.isError).toBe(false);
    const report = JSON.parse((await call('get_audit_report', { projectId: 'example-care' })).text);
    expect(report.source).toMatchObject({ status: 'action-needed', reviewer: 'Claude via Command Deck MCP' });
    expect(report.source.findings[0].title).toBe('Missing rate limit on login');
  });

  it('refuses security audits of targets that are not configured', async () => {
    const result = await call('run_security_audit', { projectId: 'example-care', target: 'local' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('no local URL');
  });

  it('dispatches work to the explicitly chosen project and lists it without step detail', async () => {
    const memory=await (await import('../server/neural-memory.js')).neuralMemory();
    memory.upsert({id:'dispatch-evidence',source:'obsidian',title:'Reviewed footer evidence',locator:'test-footer.md',text:'Website footer changes require responsive review.',updatedAt:new Date().toISOString(),projectId:'example-care'});
    const created = JSON.parse((await call('dispatch_task', { prompt: 'improve the website footer', projectId: 'example-care' })).text);
    expect(created.projectId).toBe('example-care');
    const listed = JSON.parse((await call('list_work', { limit: 5 })).text);
    expect(listed.work[0].id).toBe(created.id);
    expect(listed.work[0]).not.toHaveProperty('steps');
    const outbox=(await fs.readFile(path.join(dataDir,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    const handoff=outbox.reverse().find((item:{workItemId?:string})=>item.workItemId===created.id);
    expect(handoff.body.context).toMatchObject({untrusted:true,sources:[expect.objectContaining({title:'Reviewed footer evidence'})]});
    expect((await memory.search('queue event','example-care',8,false)).results.some(r=>r.source==='agent')).toBe(true);
  }, 30_000);
});
