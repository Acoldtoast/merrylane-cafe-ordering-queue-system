import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceRoot = path.resolve(process.cwd(), "src");

export async function resolve(specifier, context, nextResolve) {
  let candidate = specifier;
  if (candidate === "next/server" || candidate === "next/headers") {
    candidate = pathToFileURL(
      path.join(process.cwd(), "node_modules", `${candidate}.js`)
    ).href;
  }
  if (candidate.startsWith("@/")) {
    const aliasBase = path.join(sourceRoot, candidate.slice(2));
    for (const filePath of [
      `${aliasBase}.ts`,
      `${aliasBase}.tsx`,
      path.join(aliasBase, "index.ts"),
      path.join(aliasBase, "index.tsx"),
    ]) {
      if (fs.existsSync(filePath)) {
        return { url: pathToFileURL(filePath).href, shortCircuit: true };
      }
    }
    candidate = pathToFileURL(aliasBase).href;
  }

  if (
    (candidate.startsWith("./") || candidate.startsWith("../")) &&
    context.parentURL?.startsWith("file:") &&
    !path.extname(candidate)
  ) {
    const parentDirectory = path.dirname(fileURLToPath(context.parentURL));
    const basePath = path.resolve(parentDirectory, candidate);
    for (const filePath of [
      `${basePath}.ts`,
      `${basePath}.tsx`,
      path.join(basePath, "index.ts"),
      path.join(basePath, "index.tsx"),
    ]) {
      if (fs.existsSync(filePath)) {
        return { url: pathToFileURL(filePath).href, shortCircuit: true };
      }
    }
  }

  return nextResolve(candidate, context);
}
