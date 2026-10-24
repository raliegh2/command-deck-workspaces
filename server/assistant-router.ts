/** Conservative local intent routing. Only complete, anchored commands bypass the model. */
export type Action={tool:string;input:Record<string,unknown>};
export type ConversationTurn={role:string;text:string};
export type ProjectRef={id:string;name:string};
export type FastRoute={answer:string;actions:Action[];projectId?:string;kind:string};
export type RouteContext={projectId:string;projects:ProjectRef[];history:ConversationTurn[];tools:readonly {id:string;name:string;group:string}[];jobs?:{tool:string;status:string;error:string}[];previousActions?:Action[]};
const plain=(s:string)=>s.toLowerCase().replace(/[’]/g,"'").replace(/[^a-z0-9]+/g,' ').trim();
const reply=(answer:string,kind='conversation'):FastRoute=>({answer,actions:[],kind});
const action=(tool:string,input:Record<string,unknown>={}):FastRoute=>({answer:'',actions:[{tool,input}],kind:'tool'});
export function projectMention(input:string,projects:ProjectRef[]){
 const q=' '+plain(input)+' ';const matches=projects.filter(p=>[p.id,p.name].some(alias=>q.includes(' '+plain(alias)+' ')));
 if(matches.length===1)return matches[0];
 // Unique product names may be shortened, but ambiguous names never select a project.
 if(!matches.length){const generic=new Set(['command','local','engineering','portfolio','research','trading','security','cybersecurity','website','system','project']);const short=projects.filter(p=>{const brand=plain(p.name).split(' ')[0];return brand.length>=4&&!generic.has(brand)&&q.includes(' '+brand+' ');});if(short.length===1)return short[0];}
 return undefined;
}
function exactProject(input:string,projects:ProjectRef[]){const found=projectMention(input,projects);if(!found)return;const q=plain(input).replace(/^the /,'').replace(/ project$/,'');return [plain(found.id),plain(found.name),...plain(found.name).split(' ').filter(x=>x.length>=5)].includes(q)?found:undefined;}
export function conversationProject(c:RouteContext){for(const turn of [...c.history].reverse()){if(turn.role!=='user')continue;const found=projectMention(turn.text,c.projects);if(found)return found.id;}return c.projectId;}
/** Project scope comes from the user's request/session, never an inferred model argument. */
export function bindProjectScope(actions:Action[],prompt:string,c:RouteContext):Action[]{
 const explicit=c.projects.filter(p=>projectMention(prompt,[p])?.id===p.id);
 const scoped=new Set(['project.inspect','audit.web','audit.report','audit.functional','system.scan','system.verify','system.journeys','memory.context']);
 const all=/\b(?:all|every) (?:registered )?projects\b/i.test(prompt);
 const target=explicit.length===1?explicit[0].id:conversationProject(c);
 return actions.map(a=>{
  if(!scoped.has(a.tool))return a;
  if(all||explicit.length>1){if(a.input.projectId!==undefined&&!((all?c.projects:explicit).some(p=>p.id===a.input.projectId)))throw new Error('The model selected a project outside the current request.');return a;}
  return {...a,input:{...a.input,projectId:target}};
 });
}
export function fastRoute(prompt:string,c:RouteContext):FastRoute|undefined {
 const trimmed=prompt.trim(),q=plain(trimmed),command=q.replace(/^(?:hi|hello|hey) (?:there )?/,'').replace(/^(?:please )?(?:can you |could you |would you )?/,'').replace(/ please$/,'');
 if(/\b(?:deepseek|second opinion|think (?:deeply|through))\b/i.test(trimmed))return;
 const selected=c.projects.find(p=>p.id===c.projectId)?.name??c.projectId;
 if(/^(?:hi|hello|hey|hey there|hi there|hello there|good morning|good afternoon|good evening)(?: assistant| command deck)?$/.test(q))return reply(`Hi! I can help with ${selected}, run local checks, show tasks or use DeepSeek for a harder request. What would you like to do?`);
 if(/^(?:how are you|how s it going|how are things|you there|are you there)$/.test(command))return reply("I'm here and ready. You can chat with me or ask for a local task.");
 if(/^(?:thanks|thank you|thank you very much|cheers|great thanks|ok thanks|okay thanks)$/.test(q))return reply("You're welcome. What would you like to do next?");
 if(/^(?:bye|goodbye|see you|see you later)$/.test(q))return reply('See you later. This conversation is saved locally.');
 if(/^(?:who are you|what is your name|what s your name)$/.test(q))return reply("I'm Command Deck's local assistant. I handle quick conversation and clear local requests directly, and ask local DeepSeek through MCP when more reasoning is needed.");
 const name=trimmed.match(/^(?:my name is|call me) ([\p{L}][\p{L} .'-]{0,59})[.!]?$/iu);
 if(name)return reply(`Nice to meet you, ${name[1].replace(/[.!]+$/,'').trim()}. I'll keep that in this conversation.`);
 if(/^(?:what is my name|what s my name|do you remember my name|who am i)$/.test(q)){const prior=[...c.history].reverse().filter(t=>t.role==='user').map(t=>t.text.match(/^(?:my name is|call me) ([\p{L}][\p{L} .'-]{0,59})[.!]?$/iu)).find(Boolean);return reply(prior?`You asked me to call you ${prior[1].replace(/[.!]+$/,'').trim()}.`:"You haven't told me your name in this conversation yet.");}
 if(/^(?:what (?:did i|was my last) (?:ask|request|message)|what did i just ask|repeat my last message)$/.test(q)){const last=[...c.history].reverse().find(x=>x.role==='user');return reply(last?`Your previous message was: ${last.text.slice(0,1200)}`:'This is the first message in this conversation.');}
 if(/^(?:what did you (?:just )?do|what did you say|repeat your last (?:answer|message)|summarize (?:this|our) conversation)$/.test(q)){const last=[...c.history].reverse().find(x=>x.role==='assistant');return reply(last?`My last response was:\n${last.text.slice(0,1800)}`:"We haven't completed a request in this conversation yet.");}
 if(/^(?:help|what can you do|what can i ask|show (?:me )?(?:the )?(?:available |registered )?(?:tools|skills|capabilities)|list (?:the )?(?:available |registered )?(?:tools|skills|capabilities)|inspect (?:the )?registered tools)$/.test(command))return reply('I can show projects and tasks, inspect local health, check production availability, read saved research, queue approved engineering diagnostics and run registered project checks.\n\nAvailable tools:\n'+[...new Set(c.tools.map(t=>t.group))].map(g=>g+': '+c.tools.filter(t=>t.group===g).map(t=>t.name).join(', ')).join('\n')+'\n\nFor example: “show my projects”, “check local health”, “show engineering status”, or “scan this project”.', 'catalog');
 if(/^(?:show|list|inspect)(?: me)? (?:the |my |all )?(?:registered )?projects$/.test(command))return reply(c.projects.map(p=>`${p.name} (${p.id})${p.id===c.projectId?' — selected':''}`).join('\n'),'projects');
 if(/^(?:what|which) (?:project|workspace) (?:are we (?:using|in)|is selected|am i in|is this)$/.test(q))return reply(`The selected workspace is ${selected} (${c.projectId}).`,'projects');
 const focus=command.match(/^(?:switch|change|focus)(?: (?:the )?(?:project|workspace))? to (.+)$|^(?:use|select) (.+?)(?: as (?:the )?(?:project|workspace))?$/);
 if(focus){const project=exactProject(focus[1]??focus[2],c.projects);return project?{...reply(`The workspace is now ${project.name} (${project.id}).`,'focus'),projectId:project.id}:reply('Which registered project should I use? Say “show my projects” to see the choices.','clarification');}
 if(/^(?:show|list|check)(?: me)? (?:the |my |current |recent )?(?:jobs|tasks|task status|work queue)$/.test(command))return reply((c.jobs??[]).slice(0,8).map(j=>`${j.tool}: ${j.status}${j.error?' — '+j.error:''}`).join('\n')||'There are no recent local tasks.','jobs');
 if(/^(?:is command deck running|are you running locally|is this local)$/.test(q))return reply('Yes. This response is coming from the running local Command Deck server. No model call was needed.');
 if(/^(?:yes|yeah|yep|ok|okay|do it|go ahead|please do|continue)$/.test(command))return reply('Which task should I continue? Name the action, for example “check local health” or “scan this project”, so I don’t repeat the wrong work.','clarification');
 if(/^(?:again|repeat that|run that again|check (?:it|that) again|do that again)$/.test(command)){
  const previous=c.previousActions??[];const readOnly=new Set(['system.health','project.inspect','monitor.status','engineering.status','research.history','northstar.runs','audit.report','trading.context']);
  return previous.length&&previous.every(a=>readOnly.has(a.tool))?{answer:'',actions:previous,kind:'repeat'}:reply('Which check should I repeat? Name it so I can use the right inputs.','clarification');
 }
 const arithmetic=trimmed.match(/^(?:(?:what is|what's|calculate)\s+)?(-?\d{1,9}(?:\.\d{1,6})?)\s*([+*/−-])\s*(-?\d{1,9}(?:\.\d{1,6})?)\s*[?=]?$/i);
 if(arithmetic){const a=Number(arithmetic[1]),b=Number(arithmetic[3]),op=arithmetic[2];if(op==='/'&&b===0)return reply('Division by zero is undefined.');const value=op==='+'?a+b:op==='-'||op==='−'?a-b:op==='*'?a*b:a/b;return reply(`${arithmetic[1]} ${op} ${arithmetic[3]} = ${Number(value.toPrecision(12))}`,'calculation');}
 const direct:Record<string,string>={'check local health':'system.health','check system health':'system.health','check tool readiness':'system.health','check my tools':'system.health','check production availability':'monitor.probe','check production status':'monitor.status','show monitoring status':'monitor.status','show engineering status':'engineering.status','show research history':'research.history','list research runs':'research.history','show northstar runs':'northstar.runs','start local services':'system.services','start the local model':'system.model','create a backup':'system.backup','create an encrypted backup':'system.backup','verify backup recovery':'system.restore-test'};
 if(direct[command])return action(direct[command]);
 const scoped=command.match(/^(scan|audit|inspect|test|check|show)(?: (?:the|my))? (.+?)(?: project)?$/);
 if(scoped){const target=scoped[2];const project=exactProject(target,c.projects);const refers=/^(?:this project|that project|the project|it|this|that|project)$/.test(target);if(project||refers){const projectId=project?.id??conversationProject(c);if(scoped[1]==='scan')return action('system.scan',{projectId});if(scoped[1]==='test')return action('audit.functional',{projectId});if(scoped[1]==='audit')return reply('Should I run the project checks or a web security audit? Specify the audit and, for web audits, live/staging/local.','clarification');return action('project.inspect',{projectId});}}
 if(/^(?:inspect|check|scan|test|audit) (?:a )?project$/.test(command))return reply('Which project should I inspect? Say “show my projects” or name a registered project.','clarification');
 return undefined;
}

/** Keep model input small; broader discovery remains available through the MCP catalog. */
export function plannerTools<T extends {id:string;group:string;name:string;instruction:string}>(prompt:string,tools:readonly T[]):T[]{
 const q=plain(prompt);const themes:[RegExp,string[]][]=[[/website|studio|build|northstar/,['northstar.']],[/research|crawl|collect|extract|sources/,['research.','system.search','system.ingest']],[/health|ready|service|model/,['system.health','system.services','system.model']],[/audit|scan|security|malware|dependencies/,['audit.','system.scan','malware.scan']],[/production|monitor|traffic|available|availability/,['monitor.']],[/engineering|inventory|workflow|ticket|reconcil/,['engineering.']],[/project|repository|repo/,['project.inspect','audit.']],[/backup|restore/,['system.backup','system.restore-test']],[/memory|remember|handoff|previous|history/,['memory.context']],[/mcp/,['mcp.']]];
 const prefixes=themes.filter(([pattern])=>pattern.test(q)).flatMap(([,ids])=>ids);
 const chosen=tools.filter(t=>prefixes.some(prefix=>t.id.startsWith(prefix)));
 return (chosen.length?chosen:tools.filter(t=>['project.inspect','system.health','memory.context','mcp.catalog'].includes(t.id))).slice(0,8);
}
