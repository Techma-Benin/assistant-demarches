import {ajv,load} from '../scripts/lib.mjs';
// Console départementale simulée (contracts/v1/department-admin.openapi.json) : démo « un message, deux bureaux ». Mémoire seule, tout est fictif.
const spec=load('contracts/v1/department-admin.openapi.json'),specId='urn:techma:department-admin-mock';
ajv.addSchema({$id:specId,components:spec.components});
const checker=name=>ajv.getSchema(specId+'#/components/schemas/'+name);
const DAY=86400000,HOUR=3600000;
const pendingStatuses=['submitted','processing','blocked'],draftStatuses=['draft','ready','awaiting_user_validation'];
const pad=(prefix,n)=>prefix+'_'+String(n).padStart(26,'0');
const iso=ms=>new Date(ms).toISOString();
const median=v=>{if(!v.length)return null;const s=[...v].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const encode=n=>Buffer.from('o:'+n).toString('base64url');
export function createDepartmentAdmin({fail,now=Date.now()}){
 const at=ms=>iso(now-ms);
 const departments=[['justice','Ministère de la Justice','JUST',true],['enseignement','Ministère de l’Enseignement','ENS',true],['affaires-etrangeres','Ministère des Affaires étrangères','MAE',true],['sante','Ministère de la Santé','SANTE',true],['interieur','Ministère de l’Intérieur (à connecter)','INT',false]]
  .map(([id,name,code,active])=>({id,name,code,active,revision:1,createdAt:iso(now),updatedAt:iso(now)}));
 const actors=new Map(),tokens=new Map();
 const actor=(token,subject,displayName,memberships,superAdmin=false)=>{const a={subject,displayName,active:true,superAdmin,memberships,revision:1,createdAt:iso(now),updatedAt:iso(now)};actors.set(subject,a);if(token)tokens.set(token,subject);};
 actor('mock-agent-justice','agt_justice_demo','Agent Justice (démo)',[{departmentId:'justice',role:'agent',active:true}]);
 actor('mock-agent-enseignement','agt_enseignement_demo','Agent Enseignement (démo)',[{departmentId:'enseignement',role:'agent',active:true}]);
 actor('mock-super-admin','adm_super_demo','Super admin (démo)',[],true);
 actor(null,'agt_sante_demo','Agent Santé (démo)',[{departmentId:'sante',role:'agent',active:true}]);
 const deptIdsOf=a=>a.superAdmin?departments.map(d=>d.id):a.memberships.filter(m=>m.active).map(m=>m.departmentId);
 // Dossiers : métadonnées internes (département, canal) à part pour que les objets restent conformes au contrat.
 const items=new Map(),meta=new Map();let seq=0;
 const item=(dept,channel,title,procedureId,status,submitted,extra={})=>{const id=pad('req',++seq),submittedAt=at(submitted);
  const v={id,procedureId,status,fields:{},fileIds:[],officialLink:null,updatedAt:extra.completedAt??submittedAt,administrationId:dept,title,revision:1,createdAt:submittedAt,simulation:true,submittedAt,receiptRef:'SIM-RECEIPT-'+String(seq).padStart(3,'0'),assignedTo:null,...extra};
  items.set(id,v);meta.set(id,{dept,channel});return v;};
 const done=(submitted,took,by)=>({completedAt:at(submitted-took),completedBy:by});
 item('justice','whatsapp','Casier judiciaire — simulation','casier-simulation','submitted',2*HOUR,{dueAt:iso(now+3*DAY),progress:{step:1,total:4,label:'nouvelle demande, à vérifier'},fields:{typeExtrait:'bulletin n°3'}});
 item('justice','web','Casier judiciaire — simulation','casier-simulation','completed',5*DAY,{...done(5*DAY,4*60000,'ai'),fields:{typeExtrait:'bulletin n°3'}});
 item('justice','whatsapp','Acte de naissance — simulation','acte-naissance-simulation','completed',8*DAY,done(8*DAY,20*HOUR,'human'));
 item('justice','web','Certificat de nationalité — simulation','nationalite-simulation','completed',12*DAY,done(12*DAY,6*60000,'ai'));
 item('enseignement','whatsapp','Relevé de notes — simulation','releve-notes-simulation','completed',4*DAY,done(4*DAY,3*60000,'ai'));
 item('enseignement','web','Attestation de scolarité — simulation','attestation-scolarite-simulation','completed',9*DAY,done(9*DAY,5*HOUR,'human'));
 item('affaires-etrangeres','whatsapp','Passeport — simulation','passeport-simulation','processing',3*DAY,{assignedTo:'agt_mae_demo',dueAt:iso(now+5*DAY)});
 item('affaires-etrangeres','web','Légalisation de document — simulation','legalisation-simulation','blocked',6*DAY,{dueAt:at(DAY),blocking:{code:'PIECE_MANQUANTE',detail:'Pièce justificative illisible, nouvelle copie demandée.',at:at(5*DAY)}});
 item('affaires-etrangeres','whatsapp','Visa — simulation','visa-simulation','completed',10*DAY,done(10*DAY,2*DAY,'human'));
 item('sante','whatsapp','Carnet de vaccination — simulation','carnet-vaccination-simulation','submitted',DAY);
 item('sante','web','Certificat médical — simulation','certificat-medical-simulation','completed',10*DAY,done(10*DAY,4*60000,'ai'));
 const log=[],unanswered=[
  {dept:'justice',value:{id:pad('una',1),conversationId:pad('cnv',1),messageId:pad('msg',1),reason:'Aucune fiche validée pour cette question',status:'open',createdAt:at(3*HOUR),resolvedAt:null}},
  {dept:'enseignement',value:{id:pad('una',2),conversationId:pad('cnv',2),messageId:pad('msg',2),reason:'Question hors du périmètre de l’assistant',status:'open',createdAt:at(DAY),resolvedAt:null}},
  {dept:'enseignement',value:{id:pad('una',3),conversationId:pad('cnv',3),messageId:pad('msg',3),reason:'Aucune fiche validée pour cette question',status:'resolved',createdAt:at(6*DAY),resolvedAt:at(5*DAY)}}];
 const logEntry=(id,rev,actorRef,action,ago,dept)=>log.push({dept,value:{id:pad('act',log.length+1),requestId:id,revision:rev,actorRef,action,outcome:'applied',traceId:'a'.repeat(32),at:at(ago)}});
 for(const [id,v] of items){logEntry(id,1,'tooling','request.submitted',now-Date.parse(v.submittedAt),meta.get(id).dept);if(v.completedAt)logEntry(id,1,v.completedBy==='human'?'agt_'+meta.get(id).dept+'_demo':'assistant','request.completed',now-Date.parse(v.completedAt),meta.get(id).dept);}
 const out=(name,v)=>{const f=checker(name);if(!f(v))throw new Error('Réponse mock invalide ('+name+') : '+ajv.errorsText(f.errors));return structuredClone(v);};
 const check=(name,v)=>{const f=checker(name);if(!f(v))fail(400,'INVALID_REQUEST',ajv.errorsText(f.errors));};
 const page=(name,list,url)=>{
  const limit=Number(url.searchParams.get('limit')??20),raw=url.searchParams.get('cursor');let offset=0;
  if(raw!==null){const m=/^o:(\d+)$/.exec(Buffer.from(raw,'base64url').toString());if(!m)fail(400,'INVALID_REQUEST','Curseur invalide');offset=Number(m[1]);}
  if(!Number.isInteger(limit)||limit<1||limit>100)fail(400,'INVALID_REQUEST','Pagination invalide');
  return out(name,{items:list.slice(offset,offset+limit),nextCursor:offset+limit<list.length?encode(offset+limit):null});};
 const department=(a,q,{optionalForAll=false}={})=>{
  const ids=deptIdsOf(a);
  if(q){if(!departments.some(d=>d.id===q))fail(a.superAdmin?404:403,a.superAdmin?'NOT_FOUND':'FORBIDDEN','Département inconnu ou non autorisé');if(!ids.includes(q))fail(403,'FORBIDDEN','Département non autorisé');return q;}
  if(optionalForAll&&a.superAdmin)return null;
  if(!a.superAdmin&&ids.length===1)return ids[0];
  fail(400,'INVALID_REQUEST','departmentId requis');};
 const visible=(a,id)=>{const v=items.get(id);if(!v||!deptIdsOf(a).includes(v.administrationId))fail(404,'NOT_FOUND','Dossier introuvable');return v;};
 const profile=a=>out('AdminProfile',{subject:a.subject,displayName:a.displayName,...(a.email?{email:a.email}:{}),...(a.photoUrl?{photoUrl:a.photoUrl}:{}),active:a.active,superAdmin:a.superAdmin,memberships:a.memberships,revision:a.revision,createdAt:a.createdAt,updatedAt:a.updatedAt,departmentIds:deptIdsOf(a),permissions:a.superAdmin?['dept:read','dept:write','users:manage','admin:super']:['dept:read','dept:write'],identityProvider:'oidc',directorySource:'backend-demo-adapter'});
 const userView=a=>({subject:a.subject,displayName:a.displayName,...(a.email?{email:a.email}:{}),...(a.photoUrl?{photoUrl:a.photoUrl}:{}),active:a.active,superAdmin:a.superAdmin,memberships:a.memberships,revision:a.revision,createdAt:a.createdAt,updatedAt:a.updatedAt});
 const dashboard=(dept,url)=>{
  const toRaw=url.searchParams.get('to'),fromRaw=url.searchParams.get('from');const to=toRaw?Date.parse(toRaw):now+1,from=fromRaw?Date.parse(fromRaw):to-30*DAY;
  if(Number.isNaN(to)||Number.isNaN(from)||from>=to)fail(400,'INVALID_REQUEST','Période invalide');if(to-from>366*DAY)fail(400,'INVALID_REQUEST','Période limitée à 366 jours');
  const cohort=[...items.values()].filter(v=>v.administrationId===dept&&v.submittedAt&&Date.parse(v.submittedAt)>=from&&Date.parse(v.submittedAt)<to);
  const count=pred=>cohort.filter(pred).length,tally=(key)=>[...cohort.reduce((m,v)=>m.set(key(v),(m.get(key(v))??0)+1),new Map())].map(([k,c])=>[k,c]).sort((a,b)=>b[1]-a[1]);
  return out('Dashboard',{departmentId:dept,period:{from:iso(from),to:iso(to)},received:cohort.length,pending:count(v=>pendingStatuses.includes(v.status)),blocked:count(v=>v.status==='blocked'),completed:count(v=>v.status==='completed'),completedByAi:count(v=>v.status==='completed'&&v.completedBy==='ai'),rejected:count(v=>v.status==='rejected'),
   overdue:count(v=>pendingStatuses.includes(v.status)&&v.dueAt&&Date.parse(v.dueAt)<now),unanswered:unanswered.filter(u=>u.dept===dept&&u.value.status==='open').length,
   medianProcessingMs:median(cohort.filter(v=>v.status==='completed'&&v.completedAt).map(v=>Date.parse(v.completedAt)-Date.parse(v.submittedAt))),
   channels:tally(v=>meta.get(v.id).channel).map(([channel,count])=>({channel,count})),mostRequested:tally(v=>v.title).slice(0,5).map(([title,count])=>({title,count}))});};
 const transitions={
  claim:{from:['submitted'],apply:(v,a)=>{v.status='processing';v.assignedTo=a.subject;}},
  request_information:{from:['submitted','processing'],apply:(v,a,cmd)=>{v.status='blocked';v.blocking={code:'INFORMATION_REQUESTED',detail:cmd.reason??'Complément d’information demandé par l’agent.',at:iso(Date.now())};}},
  approve:{from:['submitted','processing'],apply:(v)=>{v.status='completed';v.completedBy='human';v.completedAt=iso(Date.now());delete v.blocking;}},
  reject:{from:['submitted','processing','blocked'],apply:(v)=>{v.status='rejected';delete v.blocking;}},
  resume:{from:['blocked'],apply:(v)=>{v.status='processing';delete v.blocking;}}};
 /** Renvoie [statut, corps] ou null si la route n'est pas gérée ici. `ctx` : {req,url,subject,traceId,read,idem}. */
 async function route({req,url,subject,traceId,read,idem}){
  const a=actors.get(subject),parts=url.pathname.split('/').filter(Boolean).slice(2),[resource,rid,action]=parts.map(decodeURIComponent),method=req.method;
  if(resource==='me'&&parts.length===1){
   if(method==='GET')return [200,profile(a)];
   if(method==='PUT'){const body=await read(req);check('AdminProfileUpdate',body);return idem(req,body,()=>{if(body.revision!==a.revision)fail(409,'INVALID_TRANSITION','Révision obsolète');a.displayName=body.displayName;for(const k of ['email','photoUrl'])if(k in body){if(body[k]===null)delete a[k];else a[k]=body[k];}a.revision++;a.updatedAt=iso(Date.now());return [200,profile(a)];});}
  }
  if(resource==='departments'&&parts.length===1&&method==='GET'){const ids=deptIdsOf(a);return [200,page('DepartmentPage',departments.filter(d=>ids.includes(d.id)),url)];}
  if(resource==='users'&&parts.length===1&&method==='GET'){
   const dept=department(a,url.searchParams.get('departmentId'),{optionalForAll:true}),ids=deptIdsOf(a);
   const list=[...actors.values()].filter(u=>dept?u.memberships.some(m=>m.departmentId===dept&&m.active):a.superAdmin||u.memberships.some(m=>ids.includes(m.departmentId))).map(userView);
   return [200,page('AdminUserPage',list,url)];}
  if(resource==='work-items'){
   if(parts.length===1&&method==='GET'){
    const dept=department(a,url.searchParams.get('departmentId')),status=url.searchParams.get('status')??'pending';
    const allowed={pending:pendingStatuses,completed:['completed'],draft:draftStatuses,all:null}[status];if(allowed===undefined)fail(400,'INVALID_REQUEST','status : pending, completed, draft ou all');
    const list=[...items.values()].filter(v=>v.administrationId===dept&&(!allowed||allowed.includes(v.status))).sort((x,y)=>Date.parse(y.completedAt??y.submittedAt??y.createdAt)-Date.parse(x.completedAt??x.submittedAt??x.createdAt)||(x.id<y.id?1:-1));
    return [200,page('AdminWorkItemPage',list,url)];}
   if(parts.length===2&&method==='GET')return [200,out('AdminWorkItem',visible(a,rid))];
   if(parts.length===3&&action==='actions'&&method==='POST'){
    const body=await read(req);check('AdminCommand',body);visible(a,rid);
    return idem(req,body,()=>{const v=visible(a,rid),t=transitions[body.action];
     if(v.revision!==body.revision)fail(409,'INVALID_TRANSITION','Révision obsolète');
     if(!t.from.includes(v.status))fail(409,'INVALID_TRANSITION','Action impossible depuis le statut '+v.status);
     t.apply(v,a,body);v.revision++;v.updatedAt=iso(Date.now());
     log.unshift({dept:v.administrationId,value:{id:pad('act',log.length+1),requestId:v.id,revision:v.revision,actorRef:a.subject,action:'request.'+body.action,outcome:'applied',traceId,at:v.updatedAt}});
     return [200,out('AdminWorkItem',v)];});}
  }
  if(resource==='dashboard'&&parts.length===1&&method==='GET')return [200,dashboard(department(a,url.searchParams.get('departmentId')),url)];
  if(resource==='activity'&&parts.length===1&&method==='GET'){const dept=department(a,url.searchParams.get('departmentId'));return [200,page('ActivityEntryPage',log.filter(e=>e.dept===dept).map(e=>e.value).sort((x,y)=>y.at<x.at?-1:y.at>x.at?1:0),url)];}
  if(resource==='unanswered'){
   if(parts.length===1&&method==='GET'){const dept=department(a,url.searchParams.get('departmentId'));return [200,page('UnansweredEntryPage',unanswered.filter(u=>u.dept===dept).map(u=>u.value),url)];}
   if(parts.length===3&&action==='resolve'&&method==='POST'){
    await read(req);
    return idem(req,null,()=>{const u=unanswered.find(u=>u.value.id===rid);if(!u||!(u.dept?deptIdsOf(a).includes(u.dept):a.superAdmin))fail(404,'NOT_FOUND','Question introuvable');
     if(u.value.status==='open'){u.value.status='resolved';u.value.resolvedAt=iso(Date.now());}return [200,out('ResolutionResult',{id:u.value.id,status:'resolved'})];});}
  }
  return null;
 }
 return {tokens,route,actors};
}
