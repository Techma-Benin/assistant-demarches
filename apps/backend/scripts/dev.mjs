import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { existsSync } from "node:fs";
import { join } from "node:path";

const backend = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
execFileSync(process.execPath, [fileURLToPath(new URL("build.mjs", import.meta.url))], { stdio: "inherit", cwd: backend });
// Apply versioned migrations before serving the local development API.
execFileSync(process.execPath, [
  `--env-file-if-exists=${repository}/.env`,
  fileURLToPath(new URL("../dist/apps/backend/src/cli.js", import.meta.url)), "migrate",
], { stdio: "inherit", cwd: repository });
const envFile = join(repository, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const childEnvironment = { ...process.env };
if (!childEnvironment.NODE_ENV) childEnvironment.NODE_ENV = "development";
let server;
let restarting = Promise.resolve();
let stopping = false;
const host = ts.createWatchCompilerHost(
  fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  {}, ts.sys, ts.createSemanticDiagnosticsBuilderProgram,
  diagnostic => console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  diagnostic => console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
);
const afterProgramCreate = host.afterProgramCreate;
host.afterProgramCreate = program => {
  afterProgramCreate?.(program);
  if (ts.getPreEmitDiagnostics(program.getProgram()).some(d => d.category === ts.DiagnosticCategory.Error)) return;
  restarting = restarting.then(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise(resolve => {
        const previous = server;
        const deadline = setTimeout(() => previous.kill("SIGKILL"), 3000);
        previous.once("exit", () => { clearTimeout(deadline); resolve(); });
        previous.kill("SIGTERM");
      });
    }
    if (!stopping) server = spawn(process.execPath, [
      `--env-file-if-exists=${repository}/.env`,
      fileURLToPath(new URL("../dist/apps/backend/src/main.js", import.meta.url)),
    ], { stdio: "inherit", cwd: repository, env: childEnvironment });
  });
};
const watcher = ts.createWatchProgram(host);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  stopping = true;
  watcher.close();
  server?.kill(signal);
});
