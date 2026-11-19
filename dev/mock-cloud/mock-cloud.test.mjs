import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const port = 18080;
const base = `http://127.0.0.1:${port}`;
let child;

before(async () => {
  child = spawn("node", ["server.mjs"], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      PORT: String(port),
      MOCK_EMBED_DIMENSIONS: "16",
      MOCK_S3_OBJECTS: JSON.stringify({ b: { "a/one.txt": "hello world", "a/two.txt": "second", "z/other.txt": "x" } }),
    },
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/health/live`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("mock-cloud did not start");
});
after(() => child.kill());

const embed = async (inputText) =>
  (await (await fetch(`${base}/model/m/invoke`, { method: "POST", body: JSON.stringify({ inputText }) })).json()).embedding;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

test("embeds texts that share words closer than unrelated texts", async () => {
  const [q, near, far] = await Promise.all([embed("quarterly revenue report"), embed("revenue report for the quarter"), embed("cat photos")]);
  assert.equal(q.length, 16);
  assert.ok(dot(q, near) > dot(q, far));
});

test("lists only keys under the prefix and reads them back", async () => {
  const listing = await (await fetch(`${base}/b?list-type=2&prefix=a/`)).text();
  assert.match(listing, /a\/one\.txt/);
  assert.doesNotMatch(listing, /z\/other\.txt/);
  assert.equal(await (await fetch(`${base}/b/a/one.txt`)).text(), "hello world");
  const part = await fetch(`${base}/b/a/one.txt`, { headers: { range: "bytes=0-4" } });
  assert.equal(part.status, 206);
  assert.equal(await part.text(), "hello");
});

test("answers missing objects with 404", async () => {
  assert.equal((await fetch(`${base}/b/missing`)).status, 404);
  assert.equal((await fetch(`${base}/nobucket?list-type=2`)).status, 404);
});
