// Apache-2.0. Node helper: stores signing keys in an owner-only directory/file.
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { OneClient, exportIdentity, importIdentity } from "./one.js";
export async function claimHandle(
  handle,
  {
    origin = "https://one.workrr.ai",
    directory = join(homedir(), ".one-identities"),
  } = {},
) {
  if (process.platform === "win32")
    throw Error(
      "Use a host credential store with OneClient.claimHandle on Windows",
    );
  handle = handle.toLowerCase();
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(handle)) throw Error("Invalid handle");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32" && (await stat(directory)).mode & 0o077)
    throw Error("Identity directory must be owner-only (chmod 700)");
  const filename = join(
    directory,
    `${new URL(origin).hostname}-${new URL(origin).port || "default"}-${handle}.json`,
  );
  let identity;
  try {
    if (process.platform !== "win32" && (await stat(filename)).mode & 0o077)
      throw Error("Identity file must be owner-only (chmod 600)");
    identity = await importIdentity(
      JSON.parse(await readFile(filename, "utf8")),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return new OneClient(origin).claimHandle(handle, {
    identity,
    save: async (value) => {
      if (identity) return;
      await writeFile(filename, JSON.stringify(await exportIdentity(value)), {
        mode: 0o600,
        flag: "wx",
      });
    },
  });
}
