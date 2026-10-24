import {describe,it,expect} from 'vitest';
import {browserRequestPolicy,runWebsiteWorkflows,websiteWorkflows,workflowScreenshot} from './website-workflows.js';
describe('website workflow boundaries',()=>{
 it('blocks live writes, credentials origins and external requests',()=>{expect(browserRequestPolicy('https://example.test/api','POST','https://example.test')).toBe(false);expect(browserRequestPolicy('https://other.test/','GET','https://example.test')).toBe(false);expect(browserRequestPolicy('https://example.test/','GET','https://example.test')).toBe(true);expect(browserRequestPolicy('https://user:secret@example.test/','GET','https://example.test')).toBe(false);});
 it('rejects screenshot traversal before reading files',async()=>{await expect(workflowScreenshot('../private','file.png')).rejects.toThrow('Invalid');});
 it('rejects arbitrary workflow identifiers before opening a browser',async()=>{await expect(runWebsiteWorkflows({projectId:'command-deck',workflowId:'arbitrary-script'})).rejects.toThrow('Unknown');});
 it('keeps authenticated production writes blocked and reports non-web coverage',async()=>{const catalog=await websiteWorkflows();expect(catalog.find(p=>p.projectId==='example-care')?.workflows.some(w=>w.scope==='requires-staging')).toBe(true);expect(catalog.find(p=>p.projectId==='m5-v15-research')?.workflows).toHaveLength(0);});
});
