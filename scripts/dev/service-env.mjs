/** Build a child env that does not leak shared `.env` values (DATABASE_URL, OIDC_CLIENT_ID, …) across services. */
export function serviceEnv(name, processEnv, services) {
  const scoped = services[name].env;
  const owners = new Map();
  for (const [serviceName, service] of Object.entries(services)) {
    for (const key of Object.keys(service.env)) {
      const list = owners.get(key) ?? [];
      list.push(serviceName);
      owners.set(key, list);
    }
  }
  const env = { ...processEnv };
  for (const [key, names] of owners) {
    if (!names.includes(name)) {
      delete env[key];
      continue;
    }
    env[key] = names.length > 1 ? scoped[key] : (processEnv[key] || scoped[key]);
  }
  if (!env.NODE_ENV) env.NODE_ENV = 'development';
  return env;
}
