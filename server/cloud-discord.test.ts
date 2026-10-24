import {describe,it,expect} from 'vitest';
import {enforceChatPolicy} from './local-chat.js';
import {remoteTools} from './cloud-discord.js';
describe('Remote chat execution boundary',()=>{
 it('blocks all tool execution for questions',()=>{expect(()=>enforceChatPolicy([{tool:'monitor.probe',input:{}}],{questionOnly:true})).toThrow('Question mode');expect(()=>enforceChatPolicy([],{questionOnly:true})).not.toThrow();});
 it('blocks tools outside the remote allowlist before any execution',()=>{expect(()=>enforceChatPolicy([{tool:'system.restore-test',input:{}}],{allowedTools:remoteTools})).toThrow('unavailable');expect(()=>enforceChatPolicy([{tool:'northstar.build',input:{}}],{allowedTools:remoteTools})).not.toThrow();});
 it('does not change normal local chat policy',()=>{expect(()=>enforceChatPolicy([{tool:'system.restore-test',input:{}}],{})).not.toThrow();});
});
