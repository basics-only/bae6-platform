// Development-only stand-in for Bedrock (converse, invoke) and S3 (list, get, head). It does not
// check signatures, so it refuses production and must never be exposed.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

if (process.env.NODE_ENV === "production") throw new Error("mock-cloud must not run in production");
const dimensions = Number(process.env.MOCK_EMBED_DIMENSIONS ?? 64);
// {"bucket": {"key": "text"}}
const buckets = JSON.parse(process.env.MOCK_S3_OBJECTS ?? "{}");
const modified = new Date().toUTCString();

const etag = (text) => `"${createHash("md5").update(text).digest("hex")}"`;
const tokens = (text) => Math.ceil(text.length / 4);
const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

// Hashed bag of words, so texts sharing words are close and unrelated texts are not.
function embed(text) {
  const v = new Array(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    v[createHash("sha256").update(word).digest().readUInt32BE(0) % dimensions] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

async function json(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("too large");
  }
  return JSON.parse(raw || "{}");
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");
  const reply = (status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const xml = (status, body, headers = {}) => reply(status, body, { "content-type": "application/xml", ...headers });
  try {
    if (url.pathname === "/health/live") return reply(200, { status: "ok" });

    const model = url.pathname.match(/^\/model\/[^/]+\/(converse|invoke)$/);
    if (req.method === "POST" && model) {
      const body = await json(req);
      if (model[1] === "invoke") {
        const text = String(body.inputText ?? "");
        return reply(200, { embedding: embed(text), inputTextTokenCount: tokens(text) });
      }
      const last = body.messages?.at(-1)?.content?.map((c) => c.text ?? "").join("") ?? "";
      const text = `mock reply to: ${last}`;
      return reply(200, {
        output: { message: { role: "assistant", content: [{ text }] } },
        stopReason: "end_turn",
        usage: { inputTokens: tokens(last), outputTokens: tokens(text) },
      });
    }

    const [, bucket, ...rest] = decodeURIComponent(url.pathname).split("/");
    const objects = buckets[bucket];
    if (req.method !== "GET" && req.method !== "HEAD") return reply(405, { message: "method not allowed" });
    if (!objects) return xml(404, "<Error><Code>NoSuchBucket</Code></Error>");

    if (rest.length === 0) {
      const prefix = url.searchParams.get("prefix") ?? "";
      const max = Math.min(Number(url.searchParams.get("max-keys") ?? 1000), 1000);
      const after = url.searchParams.get("continuation-token") ?? "";
      const keys = Object.keys(objects).filter((k) => k.startsWith(prefix) && k > after).sort();
      const page = keys.slice(0, max);
      const more = keys.length > page.length;
      return xml(
        200,
        `<ListBucketResult><IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${esc(page.at(-1))}</NextContinuationToken>` : ""}${page
          .map(
            (k) =>
              `<Contents><Key>${esc(k)}</Key><LastModified>${new Date(modified).toISOString()}</LastModified><ETag>${esc(etag(objects[k]))}</ETag><Size>${Buffer.byteLength(objects[k])}</Size></Contents>`,
          )
          .join("")}</ListBucketResult>`,
      );
    }

    const key = rest.join("/");
    if (!Object.hasOwn(objects, key)) return xml(404, "<Error><Code>NoSuchKey</Code></Error>");
    const data = Buffer.from(objects[key]);
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    const headers = { "content-type": "application/octet-stream", etag: etag(objects[key]), "last-modified": modified };
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(Number(range[2]), data.length - 1);
      const part = data.subarray(start, end + 1);
      res.writeHead(206, { ...headers, "content-length": part.length, "content-range": `bytes ${start}-${end}/${data.length}` });
      return res.end(req.method === "HEAD" ? undefined : part);
    }
    res.writeHead(200, { ...headers, "content-length": data.length });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    reply(400, { message: "bad request" });
  }
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
