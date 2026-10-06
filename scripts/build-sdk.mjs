import pbjs from "protobufjs-cli/pbjs.js";
import pbts from "protobufjs-cli/pbts.js";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
const generated = await new Promise((resolve, reject) =>
  pbjs.main(
    [
      "-t",
      "static-module",
      "-w",
      "es6",
      "--dependency",
      "protobufjs/minimal.js",
      "public/protocol/discussion.proto",
    ],
    (error, output) => (error ? reject(error) : resolve(output)),
  ),
);
writeFileSync("sdk/generated.js", generated);
const declarations = await new Promise((resolve, reject) =>
  pbts.main(["sdk/generated.js"], (error, output) =>
    error ? reject(error) : resolve(output),
  ),
);
writeFileSync("sdk/generated.d.ts", declarations);
mkdirSync("public/sdk", { recursive: true });
await build({
  entryPoints: ["sdk/index.ts"],
  outfile: "public/sdk/one.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
