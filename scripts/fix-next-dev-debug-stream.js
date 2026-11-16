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
const queuedWriteCall = "queueReactDebugChunk(writer,chunk);";
const queuedCloseCall = "queueReactDebugChunk(writer,null);";
const writerQueueHelper = `const reactDebugWriterQueues=new WeakMap();
function queueReactDebugChunk(writer,chunk){
  let state=reactDebugWriterQueues.get(writer);
  if(!state){
    state={queue:Promise.resolve(),closing:false,closed:false};
    reactDebugWriterQueues.set(writer,state);
  }
  if(chunk){
    if(state.closing||state.closed)return;
    state.queue=state.queue.then(async()=>{
      if(state.closed||writer.desiredSize===null){state.closed=true;return;}
      await writer.ready;
      if(state.closed||writer.desiredSize===null){state.closed=true;return;}
      await writer.write(chunk);
    }).catch(error=>{
      if(writer.desiredSize===null){state.closed=true;return;}
      console.error(error);
    });
    return;
  }
  if(state.closing||state.closed)return;
  state.closing=true;
  state.queue=state.queue.then(async()=>{
    if(state.closed||writer.desiredSize===null){state.closed=true;return;}
    await writer.ready;
    if(state.closed||writer.desiredSize===null){state.closed=true;return;}
    await writer.close();
    state.closed=true;
  }).catch(error=>{
    if(writer.desiredSize===null){state.closed=true;return;}
    console.error(error);
  });
}`;

const sourceMap = JSON.parse(
  fs.readFileSync(`${hotReloaderPath}.map`, "utf8")
);
const originalSource = sourceMap.sourcesContent?.[0];
if (typeof originalSource !== "string") {
  throw new Error(
    "Could not safely restore Next.js HMR comments. Review the installed source map."
  );
}
const sourceComments = new Set(
  originalSource
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\/\/.*)$/)?.[1])
    .filter(Boolean)
);

function restoreCommentLineBreaks(input) {
  let output = input;
  for (const comment of sourceComments) {
    let index = output.indexOf(comment);
    while (index !== -1) {
      const end = index + comment.length;
      if (output[end] && output[end] !== "\n" && output[end] !== "\r") {
        output = `${output.slice(0, end)}\n${output.slice(end)}`;
      }
      index = output.indexOf(comment, end + 1);
    }
  }
  return output;
}

const hasWriterPatch =
  source.includes("queueReactDebugChunk(writer,chunk)") &&
  source.includes("queueReactDebugChunk(writer,null)") &&
  source.includes("const reactDebugWriterQueues=new WeakMap()");
let patchedSource = restoreCommentLineBreaks(
  source
    .replace(
      "Object.assign(module.exports,{default:HotReload,performFullReload:performFullReload,processMessage:processMessage,waitForWebpackRuntimeHotUpdate:waitForWebpackRuntimeHotUpdate});",
      ""
    )
    .replace(
      "Object.assign(module.exports,{performFullReload:performFullReload,processMessage:processMessage,waitForWebpackRuntimeHotUpdate:waitForWebpackRuntimeHotUpdate});",
      ""
    )
    .replace("Object.assign(module.exports,exports);", "")
);

if (hasWriterPatch && patchedSource === source) process.exit(0);

if (!hasWriterPatch) {
  const writeCalls = [writeCall, guardedWrite].filter((call) =>
    patchedSource.includes(call)
  );
  const closeCalls = [closeCall, guardedClose].filter((call) =>
    patchedSource.includes(call)
  );
  if (writeCalls.length !== 1 || closeCalls.length !== 1) {
    throw new Error(
      "Could not safely patch Next.js's React debug-stream writer. Review the installed hot-reloader source."
    );
  }
  patchedSource = patchedSource
    .replace(writeCalls[0], queuedWriteCall)
    .replace(closeCalls[0], queuedCloseCall);
  const processMessageMarker = "function processMessage(";
  if (patchedSource.split(processMessageMarker).length !== 2) {
    throw new Error(
      "Could not safely locate Next.js's HMR message handler for the debug-stream queue."
    );
  }
  patchedSource = patchedSource.replace(
    processMessageMarker,
    `${writerQueueHelper}\n${processMessageMarker}`
  );
}

fs.writeFileSync(hotReloaderPath, patchedSource);
