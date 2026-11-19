import dgram from "node:dgram";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const socket = dgram.createSocket("udp4");

socket.on("error", (error) => {
  console.error(`Could not determine the Wi-Fi address: ${error.message}`);
  socket.close();
  process.exitCode = 1;
});

// Connecting a UDP socket selects a local route without sending a packet.
socket.connect(53, "192.0.2.1", () => {
  const address = socket.address().address;
  socket.close();
  const local = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .some((entry) => entry.family === "IPv4" && !entry.internal && entry.address === address);
  if (!local) {
    console.error("No active local IPv4 address found. Connect to the café Wi-Fi and try again.");
    process.exitCode = 1;
    return;
  }
  console.log(`Phone address: https://${address}:3112`);
  console.log("The phone must trust the development certificate authority before its camera will work.");
  const child = spawn(process.execPath, [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--experimental-https",
    "--hostname",
    address,
    "-p",
    "3112",
  ], { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`Could not start HTTPS: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
});
