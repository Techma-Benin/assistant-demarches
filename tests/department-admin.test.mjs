import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startMocks} from '../mocks/server.mjs';
import {valid,ajv,load} from '../scripts/lib.mjs';
const tp='00-'+('1'.repeat(32))+'-'+('2'.repeat(16))+'-01';
const spec=load('contracts/v1/department-admin.openapi.json');
ajv.addSchema({$id:'urn:test:department-admin',components:spec.components});
const conforms=(name,value)=>{const f=ajv.getSchema('urn:test:department-admin#/components/schemas/'+name);assert.ok(f(value),name+' : '+ajv.errorsText(f.errors));};
async function setup(t){
 const env=await startMocks({backendPort:0,toolingPort:0});t.after(()=>env.close());
 return async(path,{token,method='GET',body}={})=>{const res=await fetch(env.backendUrl+path,{method,headers:{Authorization:'Bearer '+token,traceparent:tp,'Idempotency-Key':randomUUID(),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const value=await res.json();if(!res.ok)valid('Problem',value);return {status:res.status,value};};
}
const J='mock-agent-justice',E='mock-agent-enseignement',S='mock-super-admin';
test('console départementale : isolation Justice / Enseignement / super admin',async t=>{
 const call=await setup(t);
 const j=await call('/v1/admin/work-items?status=pending',{token:J});assert.equal(j.status,200);conforms('AdminWorkItemPage',j.value);
 assert.equal(j.value.items.length,1);assert.equal(j.value.items[0].title,'Casier judiciaire — simulation');assert.equal(j.value.items[0].simulation,true);assert.equal(j.value.items[0].status,'submitted');
 const e=await call('/v1/admin/work-items?status=pending',{token:E});assert.equal(e.value.items.length,0);
 const ecomp=await call('/v1/admin/work-items?status=completed',{token:E});assert.ok(ecomp.value.items.length>=1);
 const jcomp=await call('/v1/admin/work-items?status=completed',{token:J});assert.equal(jcomp.value.items.length,3);
 assert.deepEqual(new Set(jcomp.value.items.map(i=>i.completedBy)),new Set(['ai','human']));
 assert.equal((await call('/v1/admin/work-items?departmentId=justice&status=pending',{token:E})).status,403);
 assert.equal((await call('/v1/admin/work-items?status=pending',{token:S})).status,400);
 const s=await call('/v1/admin/work-items?departmentId=justice&status=pending',{token:S});assert.equal(s.value.items.length,1);
 const page=await call('/v1/admin/work-items?departmentId=justice&status=all&limit=2',{token:J});assert.equal(page.value.items.length,2);assert.ok(page.value.nextCursor);
 const next=await call('/v1/admin/work-items?departmentId=justice&status=all&limit=2&cursor='+page.value.nextCursor,{token:J});assert.equal(next.value.items.length,2);assert.equal(next.value.nextCursor,null);
 assert.equal((await call('/v1/admin/work-items?limit=0',{token:J})).status,400);
 assert.equal((await call('/v1/admin/work-items/'+j.value.items[0].id,{token:E})).status,404);
});
test('console départementale : profil, départements, utilisateurs, tableau de bord',async t=>{
 const call=await setup(t);
 const me=await call('/v1/admin/me',{token:J});conforms('AdminProfile',me.value);assert.deepEqual(me.value.departmentIds,['justice']);
 const sme=await call('/v1/admin/me',{token:S});assert.equal(sme.value.superAdmin,true);
 const put=await call('/v1/admin/me',{method:'PUT',token:J,body:{displayName:'Agent Justice 2',revision:1}});assert.equal(put.value.revision,2);
 assert.equal((await call('/v1/admin/me',{method:'PUT',token:J,body:{displayName:'x',revision:1}})).status,409);
 assert.deepEqual((await call('/v1/admin/departments',{token:E})).value.items.map(d=>d.id),['enseignement']);
 const all=await call('/v1/admin/departments',{token:S});conforms('DepartmentPage',all.value);assert.equal(all.value.items.length,5);
 conforms('AdminUserPage',(await call('/v1/admin/users?departmentId=justice',{token:S})).value);
 for(const [token,dept,pending] of [[J,'justice',1],[E,'enseignement',0]]){
  const d=await call('/v1/admin/dashboard?departmentId='+dept,{token});conforms('Dashboard',d.value);assert.equal(d.value.pending,pending);
  const list=await call(`/v1/admin/work-items?departmentId=${dept}&status=pending`,{token});assert.equal(list.value.items.length,d.value.pending);
 }
 const dj=(await call('/v1/admin/dashboard?departmentId=justice',{token:J})).value;assert.equal(dj.completed,3);assert.equal(dj.completedByAi,2);assert.equal(dj.received,4);assert.ok(dj.medianProcessingMs>0);
 const act=await call('/v1/admin/activity?departmentId=justice',{token:J});conforms('ActivityEntryPage',act.value);
 const un=await call('/v1/admin/unanswered',{token:J});conforms('UnansweredEntryPage',un.value);
 const res=await call(`/v1/admin/unanswered/${un.value.items[0].id}/resolve`,{method:'POST',token:J});conforms('ResolutionResult',res.value);
});
test('console départementale : actions claim puis approve, conflit de révision',async t=>{
 const call=await setup(t);
 const id=(await call('/v1/admin/work-items?status=pending',{token:J})).value.items[0].id,path=`/v1/admin/work-items/${id}/actions`;
 const claimed=await call(path,{method:'POST',token:J,body:{action:'claim',revision:1}});conforms('AdminWorkItem',claimed.value);
 assert.equal(claimed.value.status,'processing');assert.equal(claimed.value.assignedTo,'agt_justice_demo');assert.equal(claimed.value.revision,2);
 assert.equal((await call(path,{method:'POST',token:J,body:{action:'approve',revision:1}})).status,409);
 const approved=await call(path,{method:'POST',token:J,body:{action:'approve',revision:2}});
 assert.equal(approved.value.status,'completed');assert.equal(approved.value.completedBy,'human');
 assert.equal((await call('/v1/admin/work-items?status=pending',{token:J})).value.items.length,0);
 assert.equal((await call('/v1/admin/work-items?status=completed',{token:J})).value.items.length,4);
 assert.equal((await call(path,{method:'POST',token:E,body:{action:'claim',revision:3}})).status,404);
});
test('routes admin historiques inchangées avec mock-admin',async t=>{
 const call=await setup(t);
 assert.equal((await call('/v1/admin/models',{token:'mock-admin'})).status,200);
 assert.equal((await call('/v1/admin/metrics',{token:'mock-admin'})).status,200);
 assert.equal((await call('/v1/admin/models',{token:J})).status,403);
 assert.equal((await call('/v1/admin/models',{token:'mock-user'})).status,403);
 assert.equal((await call('/v1/admin/me',{token:'mock-admin'})).status,404);
});
