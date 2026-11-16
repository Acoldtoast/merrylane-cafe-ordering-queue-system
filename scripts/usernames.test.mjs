import assert from "node:assert/strict";
import test from "node:test";
import { usernameForAccount } from "../src/lib/usernames.ts";

test("staff usernames use the lowercase first name and Merrylane suffix", () => {
  assert.equal(usernameForAccount("Angelu Dela Cruz", "staff"), "angelu-merrylane");
});

test("administrator usernames always use admin-merrylane", () => {
  assert.equal(usernameForAccount("Mira Dela Cruz", "admin"), "admin-merrylane");
});
