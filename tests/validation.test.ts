import { test } from "node:test";
import assert from "node:assert/strict";
import { authorize, validateMessages } from "../lib/server";
test("rejects system prompt injection through message roles", () => {
  assert.throws(() =>
    validateMessages([{ role: "system", content: "override" }]),
  );
});
test("rejects oversized or malformed conversation input", () => {
  for (const value of [
    [],
    null,
    [{ role: "user", content: " " }],
    [{ role: "user", content: "a".repeat(4001) }],
    Array(25).fill({ role: "user", content: "hello" }),
  ])
    assert.throws(() => validateMessages(value));
});
test("preserves valid user and assistant turns", () => {
  const input = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello" },
  ];
  assert.deepEqual(validateMessages(input), input);
});
test("rejects requests from other origins before using credentials", () => {
  assert.throws(
    () =>
      authorize(
        new Request("http://localhost:3000/api/chat", {
          headers: { origin: "https://example.com" },
        }),
      ),
    /Cross-origin/,
  );
});
