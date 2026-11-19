import assert from "node:assert/strict";
import { test } from "node:test";

const url = {
  oidc: "http://127.0.0.1:8085",
  otherOidc: "http://127.0.0.1:8086",
  ai: "http://127.0.0.1:8081",
  data: "http://127.0.0.1:8082",
  embed: "http://127.0.0.1:8083",
  mcp: "http://127.0.0.1:8084",
};

async function token(sub, aud, scope, issuer = url.oidc) {
  const res = await fetch(`${issuer}/token`, { method: "POST", body: JSON.stringify({ sub, aud, scope }) });
  assert.equal(res.status, 200);
  return (await res.json()).access_token;
}

async function call(base, method, path, { jwt, endUser, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
      ...(endUser ? { "bae6-end-user-token": endUser } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

const app = (aud, scope) => token("research-agent", aud, scope);
const alice = () => token("alice", "bae6-context-embed", "");

test("research agent finds approved content through embed, reads the source, asks the model and is metered", async () => {
  const embed = await app("bae6-context-embed", "embed:read embed:write");
  const as = { jwt: embed, endUser: await alice() };

  assert.equal((await call(url.embed, "PUT", "/v1/collections/kb", as)).status, 200);
  const sync = await call(url.embed, "POST", "/v1/collections/kb/syncs", { ...as, body: { prefix: "example/" } });
  assert.equal(sync.status, 202);
  let state;
  for (const deadline = Date.now() + 60_000; state?.state !== "succeeded"; ) {
    assert.ok(Date.now() < deadline, `sync did not finish: ${JSON.stringify(state)}`);
    await new Promise((r) => setTimeout(r, 200));
    state = (await call(url.embed, "GET", `/v1/collections/kb/syncs/${sync.body.id}`, as)).body;
    assert.notEqual(state.state, "failed", JSON.stringify(state));
  }
  assert.equal(state.state, "succeeded");

  const hits = await call(url.embed, "POST", "/v1/collections/kb/search", { ...as, body: { query: "expense reimbursement", limit: 3 } });
  assert.equal(hits.status, 200);
  const top = hits.body.hits[0];
  assert.match(JSON.stringify(top), /handbook\.txt/);
  assert.doesNotMatch(JSON.stringify(hits.body), /private\.txt/);

  const data = await app("bae6-context-data", "data:read");
  const object = await call(url.data, "GET", "/v1/sources/docs/objects/content?key=example/handbook.txt", { jwt: data });
  assert.equal(object.status, 200);
  assert.match(String(object.body), /ten business days/);

  const ai = await app("bae6-ai", "ai:invoke ai:usage:read");
  const spentBefore = Number((await call(url.ai, "GET", "/v1/budgets", { jwt: ai })).body.spent);
  const answer = await call(url.ai, "POST", "/v1/chat/completions", {
    jwt: ai,
    body: { model: "chat-mock", messages: [{ role: "user", content: String(object.body) }] },
  });
  assert.equal(answer.status, 200);
  assert.match(JSON.stringify(answer.body), /mock reply/);

  const usage = await call(url.ai, "GET", "/v1/usage", { jwt: ai });
  assert.equal(usage.status, 200);
  assert.ok(usage.body.data.length > 0);
  const budget = await call(url.ai, "GET", "/v1/budgets", { jwt: ai });
  assert.ok(Number(budget.body.spent) > spentBefore);
});

test("a user without an ACL entry gets no search hits", async () => {
  const embed = await app("bae6-context-embed", "embed:read");
  const mallory = await token("mallory", "bae6-context-embed", "");
  const control = await call(url.embed, "POST", "/v1/collections/kb/search", { jwt: embed, endUser: await alice(), body: { query: "expense reimbursement" } });
  assert.ok(control.body.hits.length > 0);
  const hits = await call(url.embed, "POST", "/v1/collections/kb/search", { jwt: embed, endUser: mallory, body: { query: "expense reimbursement" } });
  assert.equal(hits.status, 200);
  assert.deepEqual(hits.body.hits, []);
});

test("another organization cannot see the collection or the source", async () => {
  const own = { jwt: await token("agent", "bae6-context-embed", "embed:read"), body: { query: "x" } };
  assert.equal((await call(url.embed, "POST", "/v1/collections/kb/search", own)).status, 200);
  const ownData = await token("agent", "bae6-context-data", "data:read");
  assert.equal((await call(url.data, "GET", "/v1/sources/docs/objects/content?key=example/handbook.txt", { jwt: ownData })).status, 200);
  const embed = await token("agent", "bae6-context-embed", "embed:read", url.otherOidc);
  const data = await token("agent", "bae6-context-data", "data:read", url.otherOidc);
  assert.equal((await call(url.embed, "POST", "/v1/collections/kb/search", { jwt: embed, body: { query: "x" } })).status, 404);
  assert.equal((await call(url.data, "GET", "/v1/sources/docs/objects/content?key=example/handbook.txt", { jwt: data })).status, 404);
});

test("calls without a valid token, scope or audience are refused", async () => {
  assert.equal((await call(url.data, "GET", "/v1/sources")).status, 401);
  assert.equal((await call(url.data, "GET", "/v1/sources", { jwt: "garbage" })).status, 401);
  assert.equal((await call(url.data, "GET", "/v1/sources", { jwt: await app("bae6-context-data", "embed:read") })).status, 403);
  assert.equal((await call(url.data, "GET", "/v1/sources", { jwt: await app("bae6-ai", "data:read") })).status, 401);
  assert.equal((await call(url.ai, "GET", "/v1/usage", { jwt: await app("bae6-ai", "ai:invoke") })).status, 403);
});

test("a tool is discoverable only after approval and not after revocation", async () => {
  const publish = await app("bae6-context-mcp", "mcp:publish");
  const approve = await token("security-reviewer", "bae6-context-mcp", "mcp:approve");
  const discover = await app("bae6-context-mcp", "mcp:discover");
  const version = {
    version: "1.0.0",
    endpoint: "https://tools.example.com/mcp",
    protocolVersion: "2025-06-18",
    transport: "streamable-http",
    authentication: { method: "none" },
    tools: [{ name: "search_wiki" }],
  };
  const id = `wiki-${Date.now().toString(36)}`;
  const created = await call(url.mcp, "POST", "/v1/servers", { jwt: publish, body: { id, team: "research", name: "Wiki", version } });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const visible = async () => (await call(url.mcp, "GET", "/v1/servers", { jwt: discover })).body.items.map((s) => s.id);
  assert.ok(!(await visible()).includes(id));
  assert.equal((await call(url.mcp, "POST", `/v1/servers/${id}/approve`, { jwt: publish, body: { version: "1.0.0" } })).status, 403);
  assert.equal((await call(url.mcp, "POST", `/v1/servers/${id}/approve`, { jwt: approve, body: { version: "1.0.0" } })).status, 200);
  assert.ok((await visible()).includes(id));
  assert.equal((await call(url.mcp, "POST", `/v1/servers/${id}/revoke`, { jwt: approve, body: {} })).status, 200);
  assert.ok(!(await visible()).includes(id));
});
