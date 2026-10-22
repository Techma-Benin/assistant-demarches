import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {load} from './lib.mjs';
const base=process.env.BASE_SHA;if(!base||!/^[a-f0-9]{40}$/.test(base))throw new Error('BASE_SHA requis');
const changed=execFileSync('git',['diff','--name-only',base,'HEAD','--','contracts/'],{encoding:'utf8'}).trim();
if(changed){let previous;try{previous=JSON.parse(execFileSync('git',['show',`${base}:contracts/manifest.json`],{encoding:'utf8'}));}catch{console.log('Première introduction des contrats');process.exit(0);}
const current=load('contracts/manifest.json');const parse=v=>{assert.match(v,/^\d+\.\d+\.\d+$/);return v.split('.').map(Number);};const a=parse(previous.version),b=parse(current.version);assert.ok(b.some((v,i)=>v>a[i]&&b.slice(0,i).every((x,j)=>x===a[j])),'Augmenter la version du manifeste avant modification du contrat');console.log('Modification de contrat détectée : revue de compatibilité requise.');}
