// Importe le catalogue officiel du Portail national des services publics (service-public.bj) dans content/service-public/.
// Source unique de la base de connaissance : chaque fiche garde son identifiant officiel, son lien public et sa date de collecte.
// Usage : node scripts/import-service-public.mjs
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const API='https://service-public.bj/api/portal/publicservices';
const PAGE='https://service-public.bj/public/services/service/';
const out=fileURLToPath(new URL('../content/service-public/',import.meta.url));

async function get(url,attempt=1){
 const retry=async error=>{if(attempt>=4)throw error;await new Promise(r=>setTimeout(r,1500*attempt));return get(url,attempt+1);};
 let res;
 try{res=await fetch(url,{headers:{Accept:'application/json','User-Agent':'techma-assistant-demarches/import'},signal:AbortSignal.timeout(30000)});}
 catch(error){return retry(error);}
 if(res.ok)return res.json();
 if(res.status>=500||res.status===429)return retry(new Error(`${url} : HTTP ${res.status}`));
 throw new Error(`${url} : HTTP ${res.status}`);
}
const text=v=>typeof v==='string'&&v.trim()?v.replace(/\r\n/g,'\n').trim():null;
const list=v=>Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()):[];
const ref=v=>v&&v.id?{id:v.id,name:text(v.name)}:null;

// Liens de canal : forme réparée (« www.… », « http//… »), puis vérifiés. urlStatus : ok (réponse < 400), broken (404/410 :
// page absente), unreachable (pas de réponse exploitable après 3 essais). Seuls les liens « ok » sont exposés à l'usager.
const checked=new Map(),unreachable=[];
async function check(url){
 let last='unreachable';
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const res=await fetch(url,{redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 techma-assistant-demarches/import'},signal:AbortSignal.timeout(20000)});
   await res.body?.cancel();
   if(res.status<400)return 'ok';
   if(res.status===404||res.status===410)return 'broken';
  }catch{}
  await new Promise(r=>setTimeout(r,2000*attempt));
 }
 return last;
}
async function link(raw,serviceId){
 if(!raw)return {url:null,urlStatus:null};
 const value=raw.trim().replace(/^(https?)\/\//i,'$1://');
 const candidates=/^https?:\/\/\S+$/i.test(value)?[value]:/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value)?['https://'+value,'http://'+value]:[];
 let status='broken';
 for(const url of candidates){
  if(!checked.has(url))checked.set(url,await check(url));
  status=checked.get(url);
  if(status==='ok')return {url:new URL(url).href,urlStatus:'ok'};
 }
 unreachable.push({serviceId,published:raw,status});
 return {url:candidates[0]??null,urlStatus:status};
}

const index=await get(API+'/?categories=true&eservices=true');
const retrievedAt=new Date().toISOString();
const services=[];
for(const entry of [...index.services].sort((a,b)=>a.id.localeCompare(b.id))){
 const d=await get(API+'/'+encodeURIComponent(entry.id));
 const o=d.overview??{},m=d.mService??{},e=d.eService??{},w=d.ownerInfo??{};
 services.push({
  id:d.id,
  title:text(d.name),
  url:PAGE+d.id,
  status:text(o.status)??text(entry.status),
  published:entry.isActive===true,
  categories:list(entry.categories),
  thematicAreas:list(o.thematicArea),
  description:text(o.description),
  target:text(o.target),
  types:list(o.typeofservices),
  ownedBy:ref(o.ownedBy),
  competentAuthority:ref(o.hasCompetentAuthority),
  supervisingMinistry:ref(w.institutiontutelle),
  inPerson:m.mStatus?{status:text(m.mStatus),fee:text(m.fee),delay:text(m.delayTime),documents:text(m.mDocuments),process:text(m.mProcess),where:text(m.mWhere),...await link(text(m.url),d.id)}:null,
  online:e.eStatus?{status:text(e.eStatus),fee:text(e.eApplicationFee),delay:text(e.delayTime),documents:text(e.eRequiredDocuments),process:text(e.eProcess),...await link(text(e.eURL),d.id)}:null,
  businessHours:text(w.businessHours),
  address:text(w.address),
 });
}
mkdirSync(out,{recursive:true});
writeFileSync(out+'catalogue.json',JSON.stringify({source:'https://service-public.bj',api:API,retrievedAt,count:services.length,unreachableLinks:unreachable,services},null,1)+'\n');
console.log(`${services.length} fiches officielles importées dans content/service-public/catalogue.json (${retrievedAt}).`);
if(unreachable.length)console.log(`${unreachable.length} liens de canal non exposés (la fiche service-public.bj reste le lien de l'usager) :\n`+unreachable.map(u=>`  ${u.serviceId} [${u.status}] ${u.published}`).join('\n'));
