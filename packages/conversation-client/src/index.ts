import type {components} from '@techma/contracts-ts';
type Schemas = components['schemas'];
export class ConversationClient {
 constructor(private baseUrl:string,private token:string,private fetcher:typeof fetch=fetch) {}
 async call<T>(path:string,method:string='GET',body?:unknown,idempotencyKey?:string):Promise<T>{
  const headers:Record<string,string>={Authorization:`Bearer ${this.token}`,traceparent:`00-${crypto.randomUUID().replaceAll('-','')}-${crypto.randomUUID().replaceAll('-','').slice(0,16)}-01`};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  const res=await this.fetcher(new URL(path,this.baseUrl),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const data:unknown=await res.json();if(!res.ok)throw Object.assign(new Error(`HTTP ${res.status}`),{problem:data});return data as T;
 }
 createConversation(body:Schemas['ConversationInput'],key:string){return this.call<Schemas['Conversation']>('/v1/conversations','POST',body,key);}
 sendMessage(conversationId:string,body:Schemas['MessageInput'],key:string){return this.call<Schemas['MessageAccepted']>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`,'POST',body,key);}
 events(conversationId:string,cursor?:string){return this.call<Schemas['EventPage']>(`/v1/conversations/${encodeURIComponent(conversationId)}/events${cursor?'?cursor='+encodeURIComponent(cursor):''}`);}
}
