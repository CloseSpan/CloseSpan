import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const standaloneRoot = resolve(".next/standalone");
const standaloneNext = resolve(standaloneRoot, ".next");

if (!existsSync(resolve(standaloneRoot, "server.js"))) {
  throw new Error("Standalone server output is missing. Run next build first.");
}

mkdirSync(standaloneNext, { recursive: true });
cpSync(resolve(".next/static"), resolve(standaloneNext, "static"), {
  recursive: true,
  force: true,
});

if (existsSync(resolve("public"))) {
  cpSync(resolve("public"), resolve(standaloneRoot, "public"), {
    recursive: true,
    force: true,
  });
}
