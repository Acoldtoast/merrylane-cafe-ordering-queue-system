/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const nextPackagePath = require.resolve("next/package.json");
const nextVersion = require(nextPackagePath).version;
if (nextVersion !== "16.4.3") {
  throw new Error(
    `The dev debug-stream patch targets Next.js 16.4.3, but found ${nextVersion}. Review or remove this patch before upgrading Next.js.`
  );
}

const hotReloaderPath = path.join(
  path.dirname(nextPackagePath),
  "dist",
  "client",
  "dev",
  "hot-reloader",
  "app",
  "hot-reloader-app.js"
);
const source = fs.readFileSync(hotReloaderPath, "utf8");
const writeCall = "writer.ready.then(()=>writer.write(chunk)).catch(console.error);";
const closeCall = "writer.ready.then(()=>writer.close()).catch(console.error);";
const guardedWrite =
  "writer.ready.then(()=>{if(writer.desiredSize===null)return;return writer.write(chunk)}).catch(error=>{if(writer.desiredSize!==null)console.error(error)});";
const guardedClose =
  "writer.ready.then(()=>{if(writer.desiredSize===null)return;return writer.close()}).catch(error=>{if(writer.desiredSize!==null)console.error(error)});";

const hasWriterStateGuard =
  source.includes("writer.desiredSize===null") ||
  source.includes("writer.desiredSize === null");
if (
  hasWriterStateGuard &&
  source.includes("writer.write(chunk)") &&
  source.includes("writer.close()")
) {
  process.exit(0);
}
if (
  source.split(writeCall).length !== 2 ||
  source.split(closeCall).length !== 2
) {
  throw new Error(
    "Could not safely patch Next.js's React debug-stream writer. Review the installed hot-reloader source."
  );
}

fs.writeFileSync(
  hotReloaderPath,
  source.replace(writeCall, guardedWrite).replace(closeCall, guardedClose)
);
