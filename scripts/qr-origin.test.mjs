import assert from "node:assert/strict";
import test from "node:test";
import { qrBaseOrigin, usableBaseUrl } from "../src/lib/qrOrigin.ts";

const requestUrl = new URL("http://localhost:3112/api/qr/3");

test("loopback bases are rejected so a QR never points the phone at itself", () => {
  assert.equal(usableBaseUrl("http://localhost:3112"), null);
  assert.equal(usableBaseUrl("http://127.0.0.1:3112"), null);
  assert.equal(usableBaseUrl("http://[::1]:3112"), null);
  assert.equal(usableBaseUrl("not a url"), null);
  assert.equal(usableBaseUrl("http://192.168.8.101:3112")?.origin, "http://192.168.8.101:3112");
});

test("a configured stable base wins over the current address", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "http://192.168.8.101:3112",
      configuredBase: "https://cafe.example",
      detectedAddress: "192.168.8.101",
    }),
    "https://cafe.example"
  );
});

test("the address used to open the admin page is used when reachable", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "http://192.168.8.101:3112",
      detectedAddress: "10.0.0.5",
    }),
    "http://192.168.8.101:3112"
  );
});

test("localhost falls back to the detected LAN address with the same port", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "http://localhost:3112",
      detectedAddress: "192.168.8.101",
    }),
    "http://192.168.8.101:3112"
  );
});

test("the scheme is preserved for detected addresses", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl: new URL("https://localhost:3112/api/qr/1"),
      requestedOrigin: "https://localhost:3112",
      detectedAddress: "192.168.8.101",
    }),
    "https://192.168.8.101:3112"
  );
});

test("a stale admin-page IP falls back to the current LAN address", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "http://192.168.1.50:3112",
      requestedOriginIsCurrent: false,
      detectedAddress: "192.168.8.101",
    }),
    "http://192.168.8.101:3112"
  );
});

test("an address this machine still owns is kept as the QR base", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "http://192.168.8.101:3112",
      requestedOriginIsCurrent: true,
      detectedAddress: "10.0.0.5",
    }),
    "http://192.168.8.101:3112"
  );
});

test("a hostname base is kept even when it is not a local interface", () => {
  assert.equal(
    qrBaseOrigin({
      requestUrl,
      requestedOrigin: "https://cafe.example.com",
      requestedOriginIsCurrent: false,
      detectedAddress: "192.168.8.101",
    }),
    "https://cafe.example.com"
  );
});
