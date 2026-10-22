import fs from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
export const load = p => JSON.parse(fs.readFileSync(new URL('../'+p, import.meta.url),'utf8'));
export const domain = load('contracts/v1/domain.schema.json');
export const catalog = load('contracts/v1/mcp.tools.json');
export const ajv = new Ajv({allErrors:true,strict:false}); addFormats(ajv); ajv.addSchema(domain);
export const valid = (name,value) => {const v=ajv.getSchema(domain.$id+'#/$defs/'+name); if(!v(value)) throw Object.assign(new Error(ajv.errorsText(v.errors)),{code:'INVALID_REQUEST'});return value;};
export const validateEvent = e => { valid('Event',e); if(e.type!==`bj.techma.${e.data.kind}.v1`)throw new Error('Event type/data mismatch'); return e; };
