import process from "node:process";
import { rotatePddRunner } from "./rotate-pdd-runner-tenki.mjs";

rotatePddRunner({ force: true })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
