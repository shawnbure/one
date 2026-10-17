import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";

export async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}

/** Boot the real Workers/D1/DO runtime (wrangler dev) against a fresh temp DB,
 *  apply all migrations, and return its base URL plus the admin/moderator tokens
 *  wired via .dev.vars. Tears down when the test ends. */
export async function bootWorker(t, name = "one-commons-test") {
  const dir = mkdtempSync(join(tmpdir(), "one-"));
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  config.name = name;
  config.main = resolve("src/worker.ts");
  config.assets.directory = resolve("public");
  config.d1_databases[0].migrations_dir = resolve("migrations");
  delete config.routes;
  const configPath = join(dir, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(config));
  const adminToken = "a".repeat(32);
  const moderatorToken = "m".repeat(32);
  writeFileSync(
    join(dir, ".dev.vars"),
    `ONE_ADMIN_TOKEN=${adminToken}\nONE_MODERATOR_TOKEN=${moderatorToken}\nONE_SECRET_KEY=${"11".repeat(32)}\n`,
    { mode: 0o600 },
  );
  const cli = join(
    dirname(createRequire(import.meta.url).resolve("wrangler/package.json")),
    "bin/wrangler.js",
  );
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  execFileSync(
    process.execPath,
    [cli, "d1", "migrations", "apply", "one-commons", "--local", "--config", configPath, "--persist-to", join(dir, "state")],
    { env, stdio: "pipe" },
  );
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [cli, "dev", "--test-scheduled", "--config", configPath, "--port", String(port), "--persist-to", join(dir, "state")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((r) => {
      if (child.exitCode !== null) return r();
      child.once("exit", r);
      setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 3000).unref();
    });
    rmSync(dir, { force: true, recursive: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Worker startup timeout: " + output)), 25000);
    const read = (chunk) => {
      output += chunk;
      if (output.includes("Ready on")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(Error(`Worker exited ${code}: ${output}`));
    });
  });
  return { base: `http://127.0.0.1:${port}`, adminToken, moderatorToken };
}
