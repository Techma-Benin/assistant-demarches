import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { database } from "../dist/apps/backend/src/database.js";

function postgres() {
  const base = "/usr/lib/postgresql";
  const candidates = [
    process.env.PG_BIN,
    ...(existsSync(base)
      ? readdirSync(base)
          .sort((a, b) => Number(b) - Number(a))
          .map((v) => join(base, v, "bin"))
      : []),
  ].filter(Boolean);
  const bin = candidates.find((p) => existsSync(join(p, "initdb")));
  if (!bin)
    throw new Error(
      "PostgreSQL binaries required; set PG_BIN to the directory containing initdb and pg_ctl.",
    );
  const root = mkdtempSync(join(tmpdir(), "techma-backend-test-"));
  const data = join(root, "data");
  const socket = join(root, "socket");
  mkdirSync(socket);
  const run = (command, args) =>
    execFileSync(join(bin, command), args, { encoding: "utf8", stdio: "pipe" });
  try {
    run("initdb", [
      "-D",
      data,
      "-A",
      "trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      join(root, "postgres.log"),
      "-o",
      `-F -k ${socket} -c listen_addresses=''`,
      "-w",
      "start",
    ]);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const connection = new URL("postgresql:///postgres");
  connection.searchParams.set("host", socket);
  return {
    connection: connection.href,
    close() {
      try {
        run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}

export async function isolatedDatabase() {
  if (!process.env.BACKEND_TEST_DATABASE_URL) return postgres();
  const connection = new URL(process.env.BACKEND_TEST_DATABASE_URL);
  if (!connection.pathname.endsWith("_test"))
    throw new Error(
      "BACKEND_TEST_DATABASE_URL must name an explicit *_test database.",
    );
  const schema = "backend_test_" + randomUUID().replaceAll("-", "");
  const owner = database(connection.href);
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
  } catch (error) {
    await owner.end();
    throw error;
  }
  connection.searchParams.set("options", "-c search_path=" + schema);
  return {
    connection: connection.href,
    async close() {
      try {
        await owner.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await owner.end();
      }
    },
  };
}
