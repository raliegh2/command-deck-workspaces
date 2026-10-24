import {registerEngineering,engineeringTrace} from './engineering.js';
import {registerLocalApi} from './local-api.js';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { auditableScripts, auditReport, recordSourceReview, startFunctionalAudit, startSecurityAudit } from './audits.js';
import { addProject, loadTeams, loadProjects } from './config.js';
import { publicMessage, PublicError } from './errors.js';
import { knowledgeStatus, searchKnowledge } from './knowledge.js';
import { vaultRoot } from './knowledge.js';
import { cleanMemory, neuralMemory } from './neural-memory.js';
import { answerFromMemory, augmentedContext } from './augmented-memory.js';
import { crawlMarketIntelligence, getMarketIntelligenceView, runMarketIntelligenceBacktest } from './market-intelligence.js';
import { dispatch } from './orchestrator.js';
import { getOperationsView, runAndGetOperationsView } from './operations/index.js';
import { safeErrorCategory } from './privacy.js';
import { applyProjectFile, hash, inspectProjects, invalidateProjectCache, listProjectFiles, projectById, readProjectFile, safeProjectPath } from './projects.js';
import { auditProductionApp, productionApp, productionApps } from './production.js';
import { getProductionAlerts } from './production-alerts.js';
import { cooldown, requestGuard, requireToken, securityHeaders, sessionHandler } from './security.js';
import { addActivity, addChangeset, findChangeset, getState, updateChangeset } from './store.js';
import {securityTelemetry,securityProgramStore,flushSecurityJournal} from './security-program.js';
import {securityPractices} from '../shared/security-program.js';

export function createApp(port: number) {
  const app = express();
  const operationsCooldown = cooldown(30_000);
  const auditCooldown = cooldown(60_000);
  const securityCooldown = cooldown(60_000);
  const functionalCooldown = cooldown(15_000);
  const marketCrawlCooldown = cooldown(60_000);
  const marketBacktestCooldown = cooldown(30_000);
  const applying = new Set<string>();
  let marketCrawlRunning = false;
  let marketBacktestRunning = false;

  app.disable('x-powered-by');
  app.use(securityTelemetry);
  app.use(securityHeaders);
  app.use(requestGuard(port));
  app.use(express.json({ limit: '1mb' }));
  app.use(engineeringTrace);
  app.use('/api', requireToken(new Set(['/health', '/session'])));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-first' });
  });
  const programProjects=async()=>[...new Set(['command-deck',...(await loadProjects()).map(p=>p.id)])];
  app.get('/api/security/program',async(_req,res)=>{await flushSecurityJournal();res.json((await securityProgramStore()).status(await programProjects()));});
  app.post('/api/security/labs',async(_req,res)=>{
    const wait=securityCooldown('synthetic-labs');if(wait)return res.status(429).json({error:`Synthetic labs just ran. Try again in ${wait}s.`});
    const receipt=(await securityProgramStore()).runLabs();
    try{(await neuralMemory()).event('security-lab:'+receipt.id,'command-deck','Synthetic security exercise receipt',`Synthetic-only run ${receipt.id} at ${receipt.at}: ${receipt.results.filter(r=>r.passed).length}/${securityPractices.length} practice fixtures passed. No network calls, processes, production changes or live SIEM/EDR validation occurred.`);}catch{/* Do not lose a completed lab receipt when optional memory is unavailable. */}
    res.json(receipt);
  });
  app.post('/api/security/evidence',async(req,res)=>{
    const input=z.object({projectId:z.string().regex(/^[a-z0-9-]{1,100}$/),practiceId:z.string().max(80),owner:z.string().trim().min(3).max(100),summary:z.string().trim().min(20).max(2000),reference:z.string().trim().min(8).max(500),observedAt:z.string().datetime()}).parse(req.body);
    if(!(await programProjects()).includes(input.projectId))throw new PublicError('Registered project required.',404);
    res.status(201).json((await securityProgramStore()).submitEvidence(input));
  });
  app.post('/api/security/evidence/:id/review',async(req,res)=>{const {decision}=z.object({decision:z.enum(['approve','reject'])}).parse(req.body);res.json((await securityProgramStore()).reviewEvidence(req.params.id,decision));});

  registerEngineering(app);
  registerLocalApi(app);
  app.get('/api/session', sessionHandler);

  app.get('/api/capabilities', (_req, res) => {
    res.json({
      schemaVersion: '1.0',
      capabilities: ['project.list', 'project.read', 'change.propose', 'change.apply-with-confirmation', 'task.dispatch', 'harness.status', 'harness.consult', 'harness.coordinate', 'knowledge.search', 'production.preview', 'production.audit', 'production.change-request', 'operations.metadata-monitor', 'operations.staging-gates', 'operations.urgent-alerts', 'market-intelligence.read', 'market-intelligence.crawl', 'market-intelligence.backtest', 'discord.signed-interactions', 'assistant.local-tools', 'assistant.persistent-chat', 'production.worker-telemetry'],
      connectors: {
        localAssistant: {mode:'deepseek-mcp-local',catalog:'/api/local/tools',sessions:'/api/local/sessions',tasks:'/api/local/jobs',productionWatch:'/api/local/watch',arbitraryShell:false,hostedFallback:false},
        codexBridge: { mode: 'jsonl-outbox', path: 'data/outbox.jsonl' },
        harnessCoordinator: { mode: 'local-cli-advisory', harnesses: ['deepseek', 'codex', 'claude'], apiKeysUsed: false },
        secondBrain: { mode: 'local-obsidian-vault', writable: false },
        neuralMemory: { mode:'local-ollama-sqlite', retrievalTool:'retrieve_memory', learningTool:'record_memory_lesson', notionImportTool:'import_notion_memory', contextTool:'prepare_memory_context', answerTool:'answer_from_memory', strategies:['rag','cag','hybrid'], reviewedLessons:true },
        securityOperations:{mode:'allowlisted-local-metadata',practices:14,labs:'synthetic-only',evidence:'owner-review',statusTool:'security_program_status',productionMutations:false},
      },
    });
  });

  app.get('/api/dashboard', async (req, res) => {
    const fresh = req.query.fresh === '1';
    const [projects, knowledge, teams] = await Promise.all([inspectProjects({ fresh }), knowledgeStatus(), loadTeams()]);
    const runtime = getState();
    res.json({ projects, knowledge, teams, work: runtime.work, activity: runtime.activity, changesets: runtime.changesets });
  });

  app.post('/api/dispatch', async (req, res) => {
    const parsed = z.object({ prompt: z.string().min(3).max(4000), projectId: z.string().max(100).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please describe the problem or feature in at least three characters.' });
    res.status(202).json(await dispatch(parsed.data.prompt, await inspectProjects(), { projectId: parsed.data.projectId }));
  });

  app.get('/api/production', async (req, res) => {
    res.json({ apps: await productionApps({ fresh: req.query.fresh === '1' }) });
  });

  app.get('/api/production-alerts', async (_req, res) => {
    res.json(await getProductionAlerts());
  });

  app.get('/api/operations', async (_req, res) => {
    res.json(await getOperationsView());
  });

  app.post('/api/operations/run', async (_req, res) => {
    const wait = operationsCooldown('run');
    if (wait) return res.status(429).json({ error: `Checks just ran. Try again in ${wait}s.` });
    res.json(await runAndGetOperationsView());
  });

  app.get('/api/market-intelligence', async (_req, res) => {
    res.json(await getMarketIntelligenceView());
  });

  app.post('/api/market-intelligence/crawl', async (_req, res) => {
    if (marketCrawlRunning) return res.status(409).json({ error: 'The official-source crawl is already running.' });
    const wait = marketCrawlCooldown('official-sources');
    if (wait) return res.status(429).json({ error: `Sources were just refreshed. Try again in ${wait}s.` });
    marketCrawlRunning = true;
    try {
      res.json(await crawlMarketIntelligence());
    } finally {
      marketCrawlRunning = false;
    }
  });

  app.post('/api/market-intelligence/backtest', async (_req, res) => {
    if (marketBacktestRunning) return res.status(409).json({ error: 'The feature backtest is already running.' });
    const wait = marketBacktestCooldown('feature-backtest');
    if (wait) return res.status(429).json({ error: `A feature backtest just ran. Try again in ${wait}s.` });
    marketBacktestRunning = true;
    try {
      res.json(await runMarketIntelligenceBacktest());
    } finally {
      marketBacktestRunning = false;
    }
  });

  app.post('/api/production/:appId/audit', async (req, res) => {
    const wait = auditCooldown(req.params.appId);
    if (wait) return res.status(429).json({ error: `This system was just audited. Try again in ${wait}s.` });
    res.json(await auditProductionApp(req.params.appId));
  });

  app.post('/api/production/:appId/request-change', async (req, res) => {
    const parsed = z.object({ prompt: z.string().min(3).max(4000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please describe the requested change in at least three characters.' });
    const appConfig = await productionApp(req.params.appId);
    if (!appConfig) return res.status(404).json({ error: 'Production system not found.' });
    // Route by ID: matching on prompt text sent e.g. "improve the website" to the wrong project.
    const item = await dispatch(`For ${appConfig.name} (${appConfig.projectId}): ${parsed.data.prompt}`, await inspectProjects(), { projectId: appConfig.projectId });
    res.status(202).json(item);
  });

  app.post('/api/connectors/inbox', async (req, res) => {
    const parsed = z.object({
      schemaVersion: z.literal('1.0'),
      id: z.string().min(8).max(200),
      type: z.enum(['chat.message', 'task.requested']),
      source: z.string().min(2).max(100),
      projectId: z.string().max(100).optional(),
      timestamp: z.string().datetime(),
      body: z.object({ prompt: z.string().min(3).max(4000) }),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid connector envelope.' });
    const item = await dispatch(parsed.data.body.prompt, await inspectProjects(), { projectId: parsed.data.projectId });
    res.status(202).json({ accepted: true, workItemId: item.id, status: item.status });
  });

  app.post('/api/projects', async (req, res) => {
    const body = req.body ?? {};
    const project = await addProject({
      id: String(body.id ?? ''),
      name: String(body.name ?? ''),
      kind: body.kind ?? 'other',
      root: body.root ? String(body.root) : null,
      description: String(body.description ?? 'Registered project workspace.'),
      teamId: String(body.teamId ?? 'integration-desk'),
      // Functional audits run these scripts, so only well-known names are accepted from the API.
      allowedScripts: Array.isArray(body.allowedScripts)
        ? auditableScripts.filter((script) => (body.allowedScripts as unknown[]).includes(script))
        : ['test', 'build'],
    });
    invalidateProjectCache();
    res.status(201).json(project);
  });

  app.get('/api/projects/:projectId/files', async (req, res) => {
    const project = await projectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const depth = z.coerce.number().int().min(0).max(5).catch(3).parse(req.query.depth ?? 3);
    res.json({ files: await listProjectFiles(project, depth) });
  });

  app.get('/api/projects/:projectId/file', async (req, res) => {
    const project = await projectById(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    res.json(await readProjectFile(project, String(req.query.path ?? '')));
  });

  app.post('/api/changesets', async (req, res) => {
    const parsed = z.object({
      projectId: z.string().min(1),
      path: z.string().min(1).max(500),
      content: z.string().max(1_000_000),
      reason: z.string().min(3).max(1000),
      baseHash: z.string().length(64).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid changeset.' });
    const project = await projectById(parsed.data.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const safe = await safeProjectPath(project, parsed.data.path, { forWrite: true });
    const current = await fs.readFile(safe.target, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    const baseHash = hash(current);
    if (parsed.data.baseHash && parsed.data.baseHash !== baseHash) throw new PublicError('The file changed before the proposal was staged.', 409);
    const changeset = {
      id: 'change_' + crypto.randomUUID(),
      projectId: project.id,
      path: safe.relative,
      content: parsed.data.content,
      reason: parsed.data.reason,
      baseHash,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
    await addChangeset(changeset);
    res.status(201).json(changeset);
  });

  app.post('/api/changesets/:id/apply', async (req, res) => {
    const confirmation = z.object({ confirmation: z.literal('APPLY') }).safeParse(req.body);
    if (!confirmation.success) return res.status(400).json({ error: 'Explicit APPLY confirmation is required.' });
    const changeset = findChangeset(req.params.id);
    if (!changeset) return res.status(404).json({ error: 'Changeset not found.' });
    if (changeset.status !== 'pending' || applying.has(changeset.id)) return res.status(409).json({ error: 'Only pending changesets can be applied.' });
    const project = await projectById(changeset.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    // Guards against a double-click applying the same changeset twice.
    applying.add(changeset.id);
    try {
      const newHash = await applyProjectFile(project, changeset.path, changeset.content, changeset.baseHash);
      const applied = await updateChangeset(changeset.id, { status: 'applied', appliedAt: new Date().toISOString() });
      try { (await neuralMemory()).event(changeset.id,project.id,'Reviewed source change applied',`Command Deck applied reviewed changeset ${changeset.id}. File: ${changeset.path}. Result SHA-256: ${newHash}. Reason: ${changeset.reason}. This records a local file write, not a passing test, commit or deployment.`); } catch { /* Keep applied changes authoritative if memory is unavailable. */ }
      await addActivity({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        message: 'Applied reviewed change to ' + changeset.path,
        source: project.name,
        tone: 'green',
      });
      res.json({ changeset: applied, newHash });
    } finally {
      applying.delete(changeset.id);
    }
  });

  app.get('/api/audits/:projectId', async (req, res) => {
    res.json(await auditReport(req.params.projectId));
  });

  app.post('/api/audits/:projectId/security', async (req, res) => {
    const target = z.object({ target: z.enum(['live', 'staging', 'local']).default('live') }).parse(req.body ?? {}).target;
    const wait = securityCooldown(req.params.projectId + ':' + target);
    if (wait) return res.status(429).json({ error: `A security audit of this target just ran. Try again in ${wait}s.` });
    res.status(202).json(await startSecurityAudit(req.params.projectId, target));
  });

  app.post('/api/audits/:projectId/functional', async (req, res) => {
    const scripts = z.object({ scripts: z.array(z.enum(auditableScripts)).max(5).optional() }).parse(req.body ?? {}).scripts;
    const wait = functionalCooldown(req.params.projectId);
    if (wait) return res.status(429).json({ error: `A functional audit just started. Try again in ${wait}s.` });
    res.status(202).json(await startFunctionalAudit(req.params.projectId, scripts));
  });

  app.post('/api/audits/:projectId/source-review', async (req, res) => {
    res.status(201).json(await recordSourceReview(req.params.projectId, req.body ?? {}));
  });

  app.get('/api/knowledge/search', async (req, res) => {
    res.json({ results: await searchKnowledge(String(req.query.q ?? '').slice(0, 200)) });
  });

  app.get('/api/memory/status', async (_req, res) => res.json((await neuralMemory()).status()));
  const contextInput=z.object({query:z.string().trim().min(2).max(1000),projectId:z.string().regex(/^[a-z0-9-]{1,100}$/).default('command-deck'),mode:z.enum(['rag','cag','hybrid']).default('hybrid')});
  app.post('/api/memory/context',async(req,res)=>{const i=contextInput.parse(req.body);res.json(await augmentedContext(await neuralMemory(),cleanMemory(i.query),i.projectId,i.mode));});
  app.post('/api/memory/answer',async(req,res)=>{const i=contextInput.parse(req.body);res.json(await answerFromMemory(await neuralMemory(),cleanMemory(i.query),i.projectId,i.mode));});
  app.post('/api/memory/notion-snapshot', async (req,res)=>{
    const document=z.object({id:z.string().regex(/^notion:[a-f0-9-]{32,36}$/i),source:z.literal('notion'),title:z.string().min(1).max(300),locator:z.string().url().refine(s=>{const u=new URL(s);return u.protocol==='https:'&&['app.notion.com','www.notion.so'].includes(u.hostname)&&!u.username&&!u.password;}),text:z.string().max(500000),updatedAt:z.string().datetime(),projectId:z.string().regex(/^[a-z0-9-]+$/).optional()});
    const snapshot=z.object({capturedAt:z.string().datetime(),complete:z.boolean(),documents:z.array(document).max(1000)}).parse(req.body);
    const memory=await neuralMemory();if(memory.job.running)throw new PublicError('Wait for the current index to finish before replacing its source snapshot.',409);
    const dest=path.join(memory.directory,'notion-snapshot.json');
    snapshot.documents=snapshot.documents.map(d=>({...d,title:cleanMemory(d.title),text:cleanMemory(d.text)}));
    if(!snapshot.complete){
      const previous=await fs.readFile(dest,'utf8').then(x=>JSON.parse(x) as typeof snapshot).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return {documents:[]};throw e;});
      snapshot.documents=[...new Map([...previous.documents,...snapshot.documents].map(d=>[d.id,d])).values()];
      if(snapshot.documents.length>1000)throw new PublicError('Notion snapshot capacity reached.');
    }
    await fs.writeFile(dest+'.tmp',JSON.stringify(snapshot));await fs.rename(dest+'.tmp',dest);
    res.status(202).json(memory.startIndex(vaultRoot));
  });
  app.post('/api/memory/index', async (_req, res) => res.status(202).json((await neuralMemory()).startIndex(vaultRoot)));
  app.get('/api/memory/search', async (req, res) => {
    const input=z.object({q:z.string().min(2).max(1000),projectId:z.string().regex(/^[a-z0-9-]+$/).optional()}).parse(req.query);
    res.json(await (await neuralMemory()).search(input.q,input.projectId));
  });
  app.post('/api/memory/lessons', async (req, res) => {
    const input=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/),title:z.string().min(3).max(200),text:z.string().min(20).max(8000),evidence:z.array(z.string().min(3).max(500)).min(1).max(10)}).parse(req.body);
    if(input.projectId!=='command-deck'&&!await projectById(input.projectId))throw new PublicError('Project not found.',404);
    res.status(201).json((await neuralMemory()).record(input));
  });
  app.post('/api/memory/lessons/:id/review', async (req, res) => {
    const {decision}=z.object({decision:z.enum(['approve','reject'])}).parse(req.body);
    res.json((await neuralMemory()).review(req.params.id,decision));
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API route.' });
  });

  return app;
}

export async function serveWebBuild(app: express.Express) {
  const webDist = path.resolve('dist');
  const stat = await fs.stat(webDist).catch(() => null);
  if (!stat?.isDirectory()) return; // Vite serves the UI during development.
  app.use(express.static(webDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

/** Must be registered last. Only operator-safe messages leave the server; details stay in the category log. */
export function useErrorHandler(app: express.Express) {
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const parserType=(error as {type?:string})?.type;
    const status = error instanceof PublicError ? error.status : parserType==='entity.too.large'?413:parserType==='entity.parse.failed'?400:(error as { name?: string })?.name === 'ZodError' ? 400 : 500;
    if (status >= 500) console.error(JSON.stringify({ level: 'error', event: 'request_failed', category: safeErrorCategory(error) }));
    res.status(status).json({ error: parserType==='entity.too.large'?'Request body exceeds the allowed size.':parserType==='entity.parse.failed'?'Request body must be valid JSON.':publicMessage(error, 'Unexpected server error.'), code: safeErrorCategory(error) });
  });
}
