import fs from 'node:fs/promises';
import openapiTS, {astToString} from 'openapi-typescript';
const dir=new URL('../packages/contracts-ts/src/',import.meta.url);await fs.mkdir(dir,{recursive:true});
for(const [key,file] of [['conversation','conversation'],['admin','admin'],['tooling','tooling-internal'],['events','events'],['department-admin','department-admin'],['tooling-admin','tooling-admin']]){
 const ast=await openapiTS(new URL(`../contracts/v1/${file}.openapi.json`,import.meta.url));
 await fs.writeFile(new URL(key+'.ts',dir),astToString(ast));
}
await fs.writeFile(new URL('index.ts',dir),`// Généré par pnpm contracts:generate.\nexport type { components, paths, operations } from './conversation.js';\nexport type { paths as AdminPaths } from './admin.js';\nexport type { paths as ToolingPaths } from './tooling.js';\nexport type { paths as EventPaths } from './events.js';\nexport type { paths as DepartmentAdminPaths } from './department-admin.js';\nexport type { paths as ToolingAdminPaths } from './tooling-admin.js';\n`);
