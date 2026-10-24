import {lookup} from 'node:dns/promises';
vi.mock('node:dns/promises',()=>({lookup:vi.fn()}));
import {gzipSync} from 'node:zlib';
import {describe,it,expect,vi} from 'vitest';
import {publicAddress,publicUrl,robotsPermit,decodePublicBody,publicGet} from './public-web.js';
import {supportedValues,researchFile,runResearch} from './research-workspace.js';
describe('public research boundaries',()=>{
 it('decodes compressed pages and rejects decompression bombs',()=>{expect(decodePublicBody(gzipSync(Buffer.from('<title>Public page</title>')),'gzip')).toContain('Public page');expect(()=>decodePublicBody(gzipSync(Buffer.alloc(3000001,65)),'gzip')).toThrow();});
 it('rejects local, encoded, metadata and reserved addresses',()=>{for(const address of ['127.0.0.1','10.2.3.4','172.16.1.1','192.168.2.3','169.254.169.254','100.100.100.200','168.63.129.16','::1','::ffff:127.0.0.1','2001:db8::1','fe80::1'])expect(publicAddress(address),address).toBe(false);expect(publicAddress('1.1.1.1')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);for(const u of ['http://2130706433','http://127.1','http://localhost','http://example.com:3000','file:///etc/passwd','http://user:pass@example.com'])expect(()=>publicUrl(u)).toThrow();});
 it('rejects mixed public/private DNS answers before connecting',async()=>{vi.mocked(lookup).mockResolvedValueOnce([{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}] as never);await expect(publicGet('https://dns-boundary.example.org/')).rejects.toThrow('private');});
 it('does not allow credentials in a source query',()=>{expect(()=>publicUrl('https://example.com/?api_key=secret')).toThrow('credentials');});
 it('honors longest robots rule and allow exceptions',()=>{const rules='User-agent: *\nDisallow: /private\nAllow: /private/public\n';expect(robotsPermit(rules,'/private/data')).toBe(false);expect(robotsPermit(rules,'/private/public/example')).toBe(true);expect(robotsPermit('User-agent: CommandDeckResearch\nDisallow: /\nUser-agent: *\nAllow: /','/')).toBe(false);});
 it('keeps unsupported or invented model values empty',()=>{expect(supportedValues(['price','date'],{price:{value:'$20',quote:'Price: $20'},date:{value:'2027',quote:'Released in 2027'}},'The Price: $20 is listed.')).toEqual({values:{price:'$20',date:null},evidence:{price:'Price: $20'}});});
 it('rejects source traversal and private prompts before creating a run',async()=>{await expect(researchFile('../private','secret.txt')).rejects.toThrow('Invalid');await expect(runResearch({prompt:'Search password=super-secret'})).rejects.toThrow('private');await expect(runResearch({prompt:'Find local information',urls:['http://127.0.0.1']})).rejects.toThrow('Private');});
});
