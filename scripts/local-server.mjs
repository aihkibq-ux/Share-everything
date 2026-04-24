import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const port = Number.parseInt(process.env.PORT || "4173", 10) || 4173;
const host = process.env.HOST || "127.0.0.1";
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);
const apiHandlers = new Map([
  ["/api/image", require("../api/image.js")],
  ["/api/post", require("../api/post.js")],
  ["/api/post-data", require("../api/post-data.js")],
  ["/api/posts-data", require("../api/posts-data.js")],
  ["/api/sitemap", require("../api/sitemap.js")],
]);

function readQuery(url) {
  const query = {};
  url.searchParams.forEach((value, key) => {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
      return;
    }

    query[key] = value;
  });
  return query;
}

function createApiResponse(res) {
  let statusCode = 200;
  const headers = new Map();

  function setHeader(name, value) {
    headers.set(String(name), value);
  }

  function writeHead() {
    headers.forEach((value, name) => res.setHeader(name, value));
    res.statusCode = statusCode;
  }

  return {
    setHeader,
    getHeader(name) {
      return headers.get(String(name)) || headers.get(String(name).toLowerCase());
    },
    status(code) {
      statusCode = Number(code) || 200;
      return this;
    },
    json(payload) {
      if (!headers.has("Content-Type")) {
        setHeader("Content-Type", "application/json; charset=utf-8");
      }
      writeHead();
      res.end(JSON.stringify(payload));
      return payload;
    },
    send(payload) {
      writeHead();
      res.end(payload);
      return payload;
    },
    end(payload = "") {
      writeHead();
      res.end(payload);
      return payload;
    },
  };
}

async function invokeApiHandler(handler, req, res, query = {}) {
  await handler({
    method: req.method,
    headers: req.headers,
    query,
  }, createApiResponse(res));
}

async function serveStatic(url, res) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(rootDir, pathname));
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  const data = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
  });
  res.end(data);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);

  try {
    const postMatch = url.pathname.match(/^\/posts\/([^/?#]+)/);
    if (postMatch) {
      await invokeApiHandler(apiHandlers.get("/api/post"), req, res, {
        id: decodeURIComponent(postMatch[1]),
      });
      return;
    }

    if (url.pathname === "/post.html") {
      await invokeApiHandler(apiHandlers.get("/api/post"), req, res, readQuery(url));
      return;
    }

    const apiHandler = apiHandlers.get(url.pathname);
    if (apiHandler) {
      await invokeApiHandler(apiHandler, req, res, readQuery(url));
      return;
    }

    if (url.pathname === "/sitemap.xml") {
      await invokeApiHandler(apiHandlers.get("/api/sitemap"), req, res, readQuery(url));
      return;
    }

    await serveStatic(url, res);
  } catch (error) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Local server listening at http://${host}:${port}`);
});
