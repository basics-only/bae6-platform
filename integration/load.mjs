const seconds = Number(process.env.LOAD_SECONDS ?? 10);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 16);
const requestTimeoutMs = 10_000;
const oidc = "http://127.0.0.1:8085";

async function token(sub, aud, scope) {
  const res = await fetch(`${oidc}/token`, { method: "POST", body: JSON.stringify({ sub, aud, scope, ttlSeconds: 3600 }) });
  if (!res.ok) throw new Error(`token ${aud}: ${res.status}`);
  return (await res.json()).access_token;
}

const embed = await token("load", "bae6-context-embed", "embed:read");
const data = await token("load", "bae6-context-data", "data:read");
const ai = await token("load", "bae6-ai", "ai:invoke");
const endUser = await token("alice", "bae6-context-embed", "");

const json = { "content-type": "application/json" };
const signal = () => AbortSignal.timeout(requestTimeoutMs);
const scenarios = {
  chat: () =>
    fetch("http://127.0.0.1:8081/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${ai}`, ...json },
      body: JSON.stringify({ model: "chat-mock", messages: [{ role: "user", content: "hello" }] }),
      signal: signal(),
    }),
  search: () =>
    fetch("http://127.0.0.1:8083/v1/collections/kb/search", {
      method: "POST",
      headers: { authorization: `Bearer ${embed}`, "bae6-end-user-token": endUser, ...json },
      body: JSON.stringify({ query: "expense reimbursement", limit: 5 }),
      signal: signal(),
    }),
  read: () =>
    fetch("http://127.0.0.1:8082/v1/sources/docs/objects/content?key=example/handbook.txt", {
      headers: { authorization: `Bearer ${data}` },
      signal: signal(),
    }),
};

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;

async function once(run) {
  const start = performance.now();
  try {
    const res = await run();
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - start };
  } catch (e) {
    return { status: `error:${e.name}`, ms: performance.now() - start };
  }
}

for (const [name, run] of Object.entries(scenarios)) {
  const ok = [];
  let requests = 0;
  const statuses = {};
  const started = performance.now();
  const end = Date.now() + seconds * 1000;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < end) {
        const { status, ms } = await once(run);
        requests++;
        statuses[status] = (statuses[status] ?? 0) + 1;
        if (status === 200) ok.push(ms);
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  ok.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scenario: name,
      concurrency,
      requests,
      rps: Math.round(requests / elapsed),
      okRps: Math.round(ok.length / elapsed),
      okP50ms: Math.round(pct(ok, 0.5)),
      okP95ms: Math.round(pct(ok, 0.95)),
      okP99ms: Math.round(pct(ok, 0.99)),
      statuses,
    }),
  );
}
