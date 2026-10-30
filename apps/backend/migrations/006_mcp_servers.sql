CREATE TABLE backend_mcp_servers (
 administration_id text NOT NULL,
 id text NOT NULL,
 body jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(administration_id,id)
);
CREATE TABLE backend_mcp_tools (
 administration_id text NOT NULL,
 server_id text NOT NULL,
 name text NOT NULL,
 definition jsonb,
 enabled boolean NOT NULL DEFAULT false,
 requires_mandate boolean NOT NULL DEFAULT true,
 available boolean NOT NULL DEFAULT false,
 PRIMARY KEY(administration_id,server_id,name),
 FOREIGN KEY(administration_id,server_id) REFERENCES backend_mcp_servers(administration_id,id) ON DELETE CASCADE
);
-- Group historical action configurations by endpoint AND credential, never across tenants.
INSERT INTO backend_mcp_servers(administration_id,id,body)
SELECT administration_id,'mcp_'||md5((body->>'serverUrl')||chr(31)||(body->>'secretRef')),
 jsonb_build_object('id','mcp_'||md5((body->>'serverUrl')||chr(31)||(body->>'secretRef')),
 'name','Serveur MCP migré','url',body->>'serverUrl','enabled',true,'transport','streamable-http',
 'auth',jsonb_build_object('type','bearer','secretRef',body->>'secretRef'),'policy','techma')
FROM backend_configurations WHERE resource='tools' GROUP BY administration_id,body->>'serverUrl',body->>'secretRef';
INSERT INTO backend_mcp_tools(administration_id,server_id,name,enabled,requires_mandate)
SELECT administration_id,'mcp_'||md5((body->>'serverUrl')||chr(31)||(body->>'secretRef')),resource_id,
 (body->>'enabled')::boolean,resource_id NOT IN ('procedures.search','procedures.get','request.status','documents.verify')
FROM backend_configurations WHERE resource='tools';
