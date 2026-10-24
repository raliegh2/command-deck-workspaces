import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
for(const name of ['projects','teams','production','operations']){const file=`config/${name}.json`;if(await fs.stat(file).catch(()=>null))continue;const data=JSON.parse(await fs.readFile(`config/${name}.example.json`,'utf8'));if(name==='projects')for(const p of data)if(p.root)p.root=path.resolve(p.root);await fs.writeFile(file,JSON.stringify(data,null,2)+'\n',{flag:'wx'});}
if(!await fs.stat('config/searxng.yml').catch(()=>null))await fs.writeFile('config/searxng.yml',(await fs.readFile('config/searxng.example.yml','utf8')).replace('replace-with-generated-local-secret',crypto.randomBytes(32).toString('hex')),{flag:'wx'});
await fs.mkdir('data/vault',{recursive:true});
console.log('Local sample configuration ready. Existing configuration was preserved.');
