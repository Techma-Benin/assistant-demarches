import http from 'node:http';
import {validateEvent} from '../scripts/lib.mjs';
export async function startCallbackMock(port=0){const events=new Map();const s=http.createServer(async(req,res)=>{
 if(req.headers.authorization!=='Bearer mock-backend-delivery'){res.writeHead(401);res.end();return;}
 if(req.method!=='POST'||req.url!=='/v1/callbacks/events'){res.writeHead(404);res.end();return;}
 try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1048576)throw new Error('Payload trop grand');chunks.push(c);}const e=JSON.parse(Buffer.concat(chunks));validateEvent(e);if(e.data.kind!=='message.sent')throw new Error('message.sent requis');events.set(e.id,e);res.writeHead(204);res.end();}catch{res.writeHead(400);res.end();}
 });await new Promise(resolve=>s.listen(port,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${s.address().port}`,events,close:()=>new Promise(resolve=>s.close(resolve))};}
