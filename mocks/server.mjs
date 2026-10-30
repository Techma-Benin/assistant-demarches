import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {WebSocketServer} from 'ws';
import {ajv,catalog,load,valid,validateEvent} from '../scripts/lib.mjs';
const fixture=load('mocks/fixtures.json');
const now=()=>new Date().toISOString();
const id=p=>{let ms=Date.now(),prefix='';const a='0123456789ABCDEFGHJKMNPQRSTVWXYZ';for(let n=0;n<10;n++){prefix=a[ms%32]+prefix;ms=Math.floor(ms/32);}return p+'_'+prefix+Array.from(randomBytes(16),b=>a[b%32]).join('');};
const user1=fixture.schemas.Request.userRef,user2='usr_'+('0'.repeat(25))+'2';
const fail=(status,code,detail)=>{throw Object.assign(new Error(detail),{status,code});};
const reply=(res,status,data,mime='application/json')=>{res.writeHead(status,{'content-type':mime});res.end(JSON.stringify(data));};
async function read(req,binary=false){let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>10485760)fail(413,'FILE_TOO_LARGE','10 Mio maximum');parts.push(chunk);}const buf=Buffer.concat(parts);if(binary)return buf;try{return buf.length?JSON.parse(buf.toString()):undefined;}catch{fail(400,'INVALID_REQUEST','JSON invalide');}}
export async function startMocks({backendPort=4010,toolingPort=4020}={}){
 const conversations=new Map(),requests=new Map(),mandates=new Map(),challenges=new Map(),files=new Map(),events=new Map(),dedup=new Map(),tickets=new Map(),sockets=new Map(),ingested=new Set(),messageDigests=new Map();
 const config={models:[{id:'demo-model',provider:'mock',model:'deterministic',promptVersion:'v1',temperature:0,active:true}],tools:catalog.tools.map(t=>({name:t.name,enabled:true,serverUrl:'http://127.0.0.1:4020/mcp',secretRef:'mock-only'})),procedures:[structuredClone(fixture.schemas.Procedure)],audit:[]};
 const mcpServers=new Map(),mcpActions=new Map();
 const servers=[];const wss=new WebSocketServer({noServer:true});
 const owner=(map,key,user)=>{const v=map.get(key);if(!v||v.userRef!==user)fail(404,'NOT_FOUND','Ressource introuvable');return v;};
 const addEvent=(kind,data,traceparent,source='backend')=>{
  const e={specversion:'1.0',id:id('evt'),source:'urn:techma:'+source,type:`bj.techma.${kind}.v1`,time:now(),datacontenttype:'application/json',traceparent,data:{kind,...data}};validateEvent(e);
  const c=data.conversationId??data.request?.conversationId??data.mandate?.conversationId;
  if(c){const list=events.get(c)??[];list.push(e);events.set(c,list);for(const ws of sockets.get(c)??[])if(ws.readyState===1)ws.send(JSON.stringify(e));}return e;
 };
 const trace=req=>{const t=req.headers.traceparent;if(!/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/.test(t??''))fail(400,'INVALID_REQUEST','traceparent requis');return t;};
 const token=req=>req.headers.authorization?.replace(/^Bearer /,'');
 const principal=req=>{const t=token(req);if(t==='mock-user')return user1;if(t==='mock-user-2')return user2;if(t==='mock-admin')return 'admin-demo';fail(401,'UNAUTHORIZED','Jeton de simulation requis');};
 const schema=(n,v)=>{try{return valid(n,v);}catch(e){fail(400,'INVALID_REQUEST',e.message);}};
 async function idem(req,body,fn){const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>128)fail(400,'INVALID_REQUEST','Idempotency-Key : 8 à 128 caractères');const scope=token(req)+'|'+req.method+'|'+req.url+'|'+key;const digest=createHash('sha256').update(JSON.stringify(body??null)).digest('hex');const old=dedup.get(scope);if(old){if(old.digest!==digest)fail(409,'IDEMPOTENCY_CONFLICT','Clé réutilisée avec un autre contenu');return structuredClone(await old.promise);}const promise=Promise.resolve().then(fn);dedup.set(scope,{digest,promise});try{return structuredClone(await promise);}catch(e){dedup.delete(scope);throw e;}}
 const grant=body=>{schema('MandateGrant',body);const c=challenges.get(body.challenge.id);if(!c||c.consumed||JSON.stringify(c.value)!==JSON.stringify(body.challenge))fail(403,'FORBIDDEN','Preuve de consentement inconnue');if(Date.parse(c.value.expiresAt)<=Date.now())fail(403,'MANDATE_EXPIRED','Défi expiré');c.consumed=true;const m={id:id('mdt'),conversationId:c.value.conversationId,userRef:c.value.userRef,procedureId:c.value.procedureId,scopes:c.value.scopes,status:'active',expiresAt:new Date(Date.now()+3600000).toISOString()};mandates.set(m.id,m);return m;};
 function requireMandate(ctx,scope,procedureId){const m=mandates.get(ctx.mandateId);if(!m)fail(403,'MANDATE_MISSING','Mandat requis');if(m.status==='revoked')fail(403,'MANDATE_REVOKED','Mandat révoqué');if(Date.parse(m.expiresAt)<=Date.now())fail(403,'MANDATE_EXPIRED','Mandat expiré');if(m.userRef!==ctx.userRef||m.conversationId!==ctx.conversationId||m.procedureId!==procedureId||!m.scopes.includes(scope))fail(403,'MANDATE_SCOPE_DENIED','Portée ou propriétaire incompatible');}
 async function executeTool(name,args,ctx){const t=catalog.tools.find(t=>t.name===name);if(!t)fail(404,'NOT_FOUND','Outil inconnu');const check=ajv.compile(t.inputSchema);if(!check(args))fail(400,'INVALID_REQUEST',ajv.errorsText(check.errors));schema('ToolContext',ctx);owner(conversations,ctx.conversationId,ctx.userRef);let out;let beforeStatus;
  if(name==='procedures.search')out={items:config.procedures.filter(p=>p.title.toLowerCase().includes(args.query.toLowerCase())||args.query==='demo')};
  else if(name==='procedures.get'){out=config.procedures.find(p=>p.id===args.procedureId);if(!out)fail(404,'NOT_FOUND','Fiche inconnue');}
  else{
   let r=name==='request.create'?null:owner(requests,args.requestId,ctx.userRef);if(r&&r.conversationId!==ctx.conversationId)fail(404,'NOT_FOUND','Conversation incompatible');
   beforeStatus=r?.status;const proc=config.procedures.find(p=>p.id===(r?.procedureId??args.procedureId));if(!proc)fail(404,'NOT_FOUND','Fiche inconnue');
   const scope=t._meta['bj.techma/scopes'][0];if(scope)requireMandate(ctx,scope,proc.id);
   if(name==='request.create'){r={id:id('req'),conversationId:ctx.conversationId,userRef:ctx.userRef,procedureId:proc.id,status:'draft',fields:{},fileIds:[],officialLink:null,updatedAt:now()};requests.set(r.id,r);}
   if(['request.update','documents.attach','request.submit'].includes(name)&&!['draft','ready'].includes(r.status))fail(409,'INVALID_TRANSITION','Demande non modifiable');
   if(name==='request.update'){const combined={...r.fields,...args.fields};const v=ajv.compile({...proc.formSchema,required:[]});if(!v(combined))fail(400,'INVALID_REQUEST','Champ non autorisé');r.fields=combined;r.status=ajv.compile(proc.formSchema)(r.fields)&&r.fileIds.length?'ready':'draft';}
   if(name==='documents.attach'){const f=owner(files,args.fileId,ctx.userRef);if(Date.parse(f.expiresAt)<=Date.now())fail(409,'INVALID_REQUEST','Pièce expirée');if(!proc.requiredDocuments.includes(args.documentType))fail(400,'INVALID_REQUEST','Type de pièce inconnu');if(!r.fileIds.includes(f.id))r.fileIds.push(f.id);r.status=ajv.compile(proc.formSchema)(r.fields)?'ready':'draft';}
   if(name==='documents.verify'){owner(files,args.fileId,ctx.userRef);if(!r.fileIds.includes(args.fileId))fail(404,'NOT_FOUND','Pièce non attachée');out={fileId:args.fileId,status:'valid',reasons:[]};}
   if(name==='request.submit'){if(!ajv.compile(proc.formSchema)(r.fields)||!r.fileIds.length)fail(409,'REQUEST_INCOMPLETE','Champs ou pièces manquants');r.status='awaiting_user_validation';r.officialLink='https://example.org/demonstration';}
   if(!out)out=r;r.updatedAt=now();
  }
  if(!ajv.compile(t.outputSchema)(out))throw new Error('Sortie MCP invalide');
  const parent=`00-${ctx.traceId}-${'2'.repeat(16)}-01`;
  if(name==='request.create')addEvent('request.created',{request:structuredClone(out)},parent,'tooling');
  if(beforeStatus&&out.status&&beforeStatus!==out.status&&name!=='documents.verify')addEvent('request.status_changed',{requestId:out.id,conversationId:ctx.conversationId,from:beforeStatus,to:out.status,at:now()},parent,'tooling');
  addEvent('tool.called',{toolName:name,conversationId:ctx.conversationId,outcome:'success',code:'OK'},parent,'tooling');return structuredClone(out);
 }
 async function handle(req,res,service){try{
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){reply(res,200,{status:'ok',mode:'mock'});return;}
  const tp=trace(req);
  if(service==='tooling'&&url.pathname==='/mcp'){
   if(token(req)!=='mock-agent')fail(401,'UNAUTHORIZED','Identité agent requise');
   const ctx={conversationId:req.headers['x-conversation-id'],userRef:req.headers['x-user-ref'],traceId:tp.split('-')[1],...(req.headers['x-mandate-id']?{mandateId:req.headers['x-mandate-id']}:{})};
   const server=new Server({name:'techma-contract-mock',version:'1.0.0'},{capabilities:{tools:{}}});
   server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:catalog.tools}));
   server.setRequestHandler(CallToolRequestSchema,async call=>{try{
    const t=catalog.tools.find(t=>t.name===call.params.name);
    const run=()=>executeTool(call.params.name,call.params.arguments,ctx);
    const out=t?._meta['bj.techma/requiresMandate']?await idem(req,{name:call.params.name,args:call.params.arguments,ctx},run):await run();
    return {content:[{type:'text',text:JSON.stringify(out)}],structuredContent:out};
   }catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({code:e.code??'INVALID_REQUEST',detail:e.message,traceId:ctx.traceId})}]};}});
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
   res.on('close',()=>{transport.close();server.close();});await server.connect(transport);await transport.handleRequest(req,res,await read(req));return;
  }
  if(service==='tooling'){
   if(token(req)!=='mock-backend-control')fail(401,'UNAUTHORIZED','Identité contrôle mandat requise');
   const b=await read(req);const [code,result]=await idem(req,b,()=>{
    if(req.method==='POST'&&url.pathname==='/internal/v1/mandates')return [201,grant(b)];
    const match=url.pathname.match(/^\/internal\/v1\/mandates\/(mdt_[A-Z0-9]+)\/revoke$/);if(match&&req.method==='POST'){const m=mandates.get(match[1]);if(!m)fail(404,'NOT_FOUND','Mandat inconnu');m.status='revoked';return [200,m];}fail(404,'NOT_FOUND','Route inconnue');
   });reply(res,code,result);return;
  }
  if(url.pathname==='/internal/v1/events'&&req.method==='POST'){
   if(token(req)!=='mock-tooling-events')fail(401,'UNAUTHORIZED','Identité événement requise');const b=await read(req);try{validateEvent(b);}catch(e){fail(400,'INVALID_REQUEST',e.message);}if(b.source!=='urn:techma:tooling')fail(403,'FORBIDDEN','Source incompatible');
   const result=await idem(req,b,()=>{if(!ingested.has(b.id)){const c=b.data.conversationId??b.data.request?.conversationId??b.data.mandate?.conversationId;if(c&&!conversations.has(c))fail(404,'NOT_FOUND','Conversation inconnue');ingested.add(b.id);if(c){const list=events.get(c)??[];list.push(b);events.set(c,list);for(const ws of sockets.get(c)??[])if(ws.readyState===1)ws.send(JSON.stringify(b));}}return b;});reply(res,202,result);return;
  }
  if(req.method==='POST'&&/^\/internal\/v1\/requests\/[^/]+\/documents$/.test(url.pathname)){
   if(token(req)!=='mock-tooling-documents')fail(401,'UNAUTHORIZED','Identité documents Tooling requise');trace(req);const owner=req.headers['x-user-ref'];if(typeof owner!=='string'||!owner)fail(400,'INVALID_REQUEST','X-User-Ref requis');
   if(req.headers['content-type']!=='application/octet-stream')fail(415,'UNSUPPORTED_MEDIA_TYPE','Dépôt binaire requis');const mime=req.headers['x-file-mime-type'];if(!['application/pdf','image/png','image/jpeg'].includes(mime))fail(415,'UNSUPPORTED_MEDIA_TYPE','Format de document délivré non autorisé');const b=await read(req,true);if(!b.length)fail(400,'INVALID_REQUEST','Document vide');
   const f=await idem(req,{digest:createHash('sha256').update(b).digest('hex'),mime,owner},()=>{const f={id:id('fil'),mimeType:mime,sizeBytes:b.length,expiresAt:new Date(Date.now()+30*86400000).toISOString()};files.set(f.id,{...f,userRef:owner,issuedFor:url.pathname.split('/')[4]});return f;});reply(res,201,f);return;
  }
  if(url.pathname.startsWith('/internal/v1/procedures')||url.pathname.startsWith('/internal/v1/files/')){
   if(token(req)!=='mock-tooling-resources')fail(401,'UNAUTHORIZED','Identité ressources Tooling requise');if(req.method!=='GET')fail(404,'NOT_FOUND','Route inconnue');
   if(url.pathname==='/internal/v1/procedures'){const q=url.searchParams.get('query');if(!q)fail(400,'INVALID_REQUEST','query requis');reply(res,200,{items:config.procedures.filter(p=>q==='demo'||p.title.toLowerCase().includes(q.toLowerCase())),nextCursor:null});return;}
   if(url.pathname.startsWith('/internal/v1/procedures/')){const p=config.procedures.find(p=>p.id===decodeURIComponent(url.pathname.split('/').at(-1)));if(!p)fail(404,'NOT_FOUND','Fiche inconnue');reply(res,200,p);return;}
   const f=owner(files,url.pathname.split('/').at(-1),req.headers['x-user-ref']);const {userRef,...metadata}=f;reply(res,200,{file:metadata,userRef});return;
  }
  const user=principal(req);
  if(url.pathname.startsWith('/v1/admin/')){
   if(user!=='admin-demo')fail(403,'FORBIDDEN','Rôle administrateur requis');const resource=url.pathname.split('/')[3];
   const rid=decodeURIComponent(url.pathname.split('/')[4]??'');
   if(resource==='mcp-servers'){
    const action=url.pathname.split('/')[5],toolName=decodeURIComponent(url.pathname.split('/')[6]??'');
    const server=rid?mcpServers.get(rid):undefined;
    if(rid&&!server&&req.method!=='DELETE')fail(404,'NOT_FOUND','Serveur MCP inconnu');
    const toolPage=()=>({items:[...(mcpActions.get(rid)?.values()??[])],nextCursor:null});
    if(req.method==='GET'){reply(res,200,action==='tools'?toolPage():rid?server:{items:[...mcpServers.values()],nextCursor:null});return;}
    const body=await read(req);
    if(action==='discover'&&req.method==='POST'){
     const previous=mcpActions.get(rid)??new Map();
     mcpActions.set(rid,new Map(catalog.tools.map(t=>[t.name,{...t,enabled:previous.get(t.name)?.enabled??false,requiresMandate:previous.get(t.name)?.requiresMandate??true,available:true,modelName:'mcp_'+createHash('sha256').update(rid+'\0'+t.name).digest('hex').slice(0,48)}])));
     reply(res,200,toolPage());return;
    }
    if(action==='tools'&&toolName&&req.method==='PUT'){schema('McpToolPermission',body);const tool=mcpActions.get(rid)?.get(toolName);if(!tool)fail(404,'NOT_FOUND','Action non découverte');Object.assign(tool,body);reply(res,200,tool);return;}
    if(action)fail(404,'NOT_FOUND','Route inconnue');
    if(req.method!=='DELETE'){schema('McpServer',body);if(body.url!=='http://127.0.0.1:4020/mcp')fail(403,'FORBIDDEN','Serveur non autorisé dans les mocks');if(rid&&rid!==body.id)fail(400,'INVALID_REQUEST','Identifiant incompatible');}
    const [code,result]=await idem(req,body,()=>{const target=rid||body.id;if(req.method==='POST'){if(mcpServers.has(target))fail(409,'INVALID_TRANSITION','Serveur existant');mcpServers.set(target,body);return [201,body];}
     if(req.method==='PUT'){if(JSON.stringify([server.url,server.auth,server.policy])!==JSON.stringify([body.url,body.auth,body.policy]))mcpActions.delete(target);mcpServers.set(target,body);return [200,body];}
     if(req.method==='DELETE'){if(!mcpServers.has(target))fail(404,'NOT_FOUND','Serveur MCP inconnu');mcpServers.delete(target);mcpActions.delete(target);return [204,null];}fail(404,'NOT_FOUND','Route inconnue');});reply(res,code,result);return;
   }
   const configurable=['models','tools','procedures'].includes(resource);
   if(req.method==='GET'){if(resource==='metrics'){reply(res,200,{conversationCount:conversations.size,p95LatencyMs:0,sourcedAnswerRate:0,errorCount:0});return;}let items=resource==='conversations'?[...conversations.values()]:config[resource];if(!items)fail(404,'NOT_FOUND','Ressource inconnue');if(rid){if(!configurable)fail(404,'NOT_FOUND','Route inconnue');const item=items.find(v=>(v.id??v.name)===rid);if(!item)fail(404,'NOT_FOUND','Ressource inconnue');reply(res,200,item);return;}const limit=Number(url.searchParams.get('limit')??20),cursor=Number(url.searchParams.get('cursor')??0);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(cursor)||cursor<0)fail(400,'INVALID_REQUEST','Pagination invalide');reply(res,200,{items:items.slice(cursor,cursor+limit),nextCursor:cursor+limit<items.length?String(cursor+limit):null});return;}
   if(configurable&&((req.method==='POST'&&!rid)||(['PUT','DELETE'].includes(req.method)&&rid))){
    const body=await read(req);if(req.method!=='DELETE')schema({models:'ModelConfig',tools:'ToolConfig',procedures:'Procedure'}[resource],body);else if(body!==undefined)fail(400,'INVALID_REQUEST','DELETE sans corps');
    const target=req.method==='POST'?(body.id??body.name):rid;if(req.method==='PUT'&&(body.id??body.name)!==rid)fail(400,'INVALID_REQUEST','Identifiant incompatible');
    const [code,out]=await idem(req,body,()=>{if(resource==='procedures'&&body){if(body.administrationId!==fixture.schemas.Procedure.administrationId)fail(403,'FORBIDDEN','Administration incompatible');ajv.compile(body.formSchema);}if(resource==='tools'&&body&&body.serverUrl!=='http://127.0.0.1:4020/mcp')fail(403,'FORBIDDEN','Serveur MCP non autorisé');const index=config[resource].findIndex(v=>(v.id??v.name)===target);
     if(req.method==='POST'&&index>=0)fail(409,'INVALID_TRANSITION','Configuration existante');if(req.method!=='POST'&&index<0)fail(404,'NOT_FOUND','Ressource inconnue');
     if(req.method==='DELETE'&&resource==='procedures'&&([...requests.values(),...mandates.values(),...[...challenges.values()].map(c=>c.value)].some(v=>v.procedureId===target)))fail(409,'INVALID_TRANSITION','Fiche référencée');
     if(req.method==='POST')config[resource].push(body);else if(req.method==='PUT')config[resource][index]=body;else config[resource].splice(index,1);
     const operation=req.method==='POST'?'created':req.method==='PUT'?'updated':'deleted';config.audit.push({id:id('aud'),actorRef:user,action:'configuration.changed.'+operation,resourceId:target,at:now(),traceId:tp.split('-')[1]});return [req.method==='POST'?201:req.method==='PUT'?200:204,body];});reply(res,code,out);return;
   }fail(404,'NOT_FOUND','Route inconnue');
  }
  if(user==='admin-demo')fail(403,'FORBIDDEN','Session usager requise');
  if(req.method==='POST'&&url.pathname==='/v1/conversations'){
   const b=await read(req);schema('ConversationInput',b);const result=await idem(req,b,()=>{const c={id:id('cnv'),userRef:user,...b,createdAt:now()};conversations.set(c.id,c);return c;});reply(res,201,result);return;
  }
  if(req.method==='POST'&&url.pathname==='/v1/files'){
   if(req.headers['content-type']!=='application/octet-stream')fail(415,'UNSUPPORTED_MEDIA_TYPE','application/octet-stream requis');const mime=req.headers['x-file-mime-type'];if(!fixture.schemas.File||!['application/pdf','image/jpeg','image/png','audio/ogg','audio/mpeg','audio/mp4'].includes(mime))fail(415,'UNSUPPORTED_MEDIA_TYPE','MIME non autorisé');const b=await read(req,true);if(!b.length)fail(400,'INVALID_REQUEST','Fichier vide');const f=await idem(req,{digest:createHash('sha256').update(b).digest('hex'),mime},()=>{const f={id:id('fil'),mimeType:mime,sizeBytes:b.length,expiresAt:new Date(Date.now()+86400000).toISOString()};files.set(f.id,{...f,userRef:user});return f;});reply(res,201,f);return;
  }
  const requestMatch=url.pathname.match(/^\/v1\/requests\/(req_[A-Z0-9]+)$/);if(requestMatch&&req.method==='GET'){reply(res,200,owner(requests,requestMatch[1],user));return;}
  const match=url.pathname.match(/^\/v1\/conversations\/(cnv_[A-Z0-9]+)\/(.+)$/);if(!match)fail(404,'NOT_FOUND','Route inconnue');const [,cid,action]=match;owner(conversations,cid,user);
  if(action==='events'&&req.method==='GET'){const list=events.get(cid)??[],cursor=url.searchParams.get('cursor');const index=cursor?list.findIndex(e=>e.id===cursor):-1;if(cursor&&index<0)fail(410,'REPLAY_EXPIRED','Curseur inconnu ou expiré');const items=list.slice(index+1,index+101);reply(res,200,{items,nextCursor:items.at(-1)?.id??cursor??null});return;}
  if(req.method!=='POST')fail(404,'NOT_FOUND','Route inconnue');const b=await read(req);
  const result=await idem(req,b,()=>{
   if(action==='messages'){schema('MessageInput',b);if(b.content.fileId)owner(files,b.content.fileId,user);const digest=createHash('sha256').update(JSON.stringify(b)).digest('hex');const seen=messageDigests.get(cid+'|'+b.id);if(seen){if(seen!==digest)fail(409,'IDEMPOTENCY_CONFLICT','Identifiant message réutilisé');return [202,{messageId:b.id,conversationId:cid,status:'accepted'}];}messageDigests.set(cid+'|'+b.id,digest);addEvent('message.received',{conversationId:cid,messageId:b.id},tp);const message={...structuredClone(fixture.schemas.AgentMessage),id:id('msg'),conversationId:cid,createdAt:now()};addEvent('message.sent',{conversationId:cid,message},tp);return [202,{messageId:b.id,conversationId:cid,status:'accepted'}];}
   if(action==='socket-ticket'){const ticket=randomBytes(24).toString('hex');tickets.set(ticket,{conversationId:cid,expires:Date.now()+60000});return [201,{ticket,expiresAt:new Date(Date.now()+60000).toISOString(),url:`ws://127.0.0.1:${servers[0].address().port}/v1/stream?ticket=${ticket}`}];}
   if(action==='mandate-challenges'){schema('ChallengeInput',b);if(!config.procedures.some(p=>p.id===b.procedureId))fail(404,'NOT_FOUND','Démarche inconnue');const c={id:id('chl'),conversationId:cid,userRef:user,...b,proofToken:'mock-proof-'+randomBytes(16).toString('hex'),consentText:'Autoriser cette démarche fictive pour une heure : '+b.scopes.join(', '),expiresAt:new Date(Date.now()+300000).toISOString()};challenges.set(c.id,{value:c,consumed:false});return [201,c];}
   if(action==='mandates'){schema('Consent',b);const c=challenges.get(b.challengeId);if(!c||c.value.conversationId!==cid||c.value.userRef!==user)fail(403,'FORBIDDEN','Consentement incompatible');const m=grant({challenge:c.value,acceptedAt:now(),evidenceRef:id('proof')});addEvent('mandate.granted',{mandate:m},tp);return [201,m];}
   const m=action.match(/^mandates\/(mdt_[A-Z0-9]+)\/revoke$/);if(m){const mandate=owner(mandates,m[1],user);if(mandate.conversationId!==cid)fail(404,'NOT_FOUND','Mandat inconnu');mandate.status='revoked';addEvent('mandate.revoked',{mandate},tp);return [200,mandate];}fail(404,'NOT_FOUND','Route inconnue');
  });reply(res,...result);
 }catch(e){reply(res,e.status??500,{type:'about:blank',title:e.code??'INVALID_REQUEST',status:e.status??500,detail:e.message,code:e.code??'INVALID_REQUEST',traceId:/^00-([a-f0-9]{32})-/.exec(req.headers.traceparent??'')?.[1]??'0'.repeat(32)},'application/problem+json');}}
 for(const [port,service] of [[backendPort,'backend'],[toolingPort,'tooling']]){const s=http.createServer((req,res)=>handle(req,res,service));servers.push(s);await new Promise(resolve=>s.listen(port,'127.0.0.1',resolve));}
 servers[0].on('upgrade',(req,socket,head)=>{const u=new URL(req.url,'http://localhost'),ticket=tickets.get(u.searchParams.get('ticket'));tickets.delete(u.searchParams.get('ticket'));if(u.pathname!=='/v1/stream'||!ticket||ticket.expires<Date.now()){socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{const list=events.get(ticket.conversationId)??[],cursor=u.searchParams.get('cursor'),index=cursor?list.findIndex(e=>e.id===cursor):-1;if(cursor&&index<0){ws.close(1008,'REPLAY_EXPIRED');return;}const peers=sockets.get(ticket.conversationId)??new Set();peers.add(ws);sockets.set(ticket.conversationId,peers);ws.on('close',()=>peers.delete(ws));for(const e of list.slice(index+1))ws.send(JSON.stringify(e));});});
 return {backendUrl:`http://127.0.0.1:${servers[0].address().port}`,toolingUrl:`http://127.0.0.1:${servers[1].address().port}`,close:async()=>{for(const ws of wss.clients)ws.terminate();await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));},executeTool};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const m=await startMocks();console.log(`SIMULATION LOCALE — C1/C3/C4 ${m.backendUrl} ; C2 ${m.toolingUrl}/mcp`);for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await m.close();process.exit(0);});}
