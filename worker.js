import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import requestHandler from "./server.js";

function toNodeReq(request, bodyBuffer, url) {
  const req = new EventEmitter();
  req.method = request.method || "GET";
  req.url = url.pathname + url.search;
  req.headers = {};
  request.headers.forEach((value, key) => {
    req.headers[key.toLowerCase()] = value;
  });
  if (!req.headers.host && url.host) {
    req.headers.host = url.host;
  }
  if (!req.headers["x-forwarded-proto"]) {
    req.headers["x-forwarded-proto"] = url.protocol.replace(":", "") || "https";
  }
  req.socket = {
    remoteAddress: req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "127.0.0.1",
    encrypted: url.protocol === "https:"
  };
  req.destroy = () => {};

  const originalOn = req.on.bind(req);
  let bodyEmitted = false;
  req.on = function on(event, listener) {
    const res = originalOn(event, listener);
    if ((event === "data" || event === "end") && !bodyEmitted) {
      bodyEmitted = true;
      queueMicrotask(() => {
        if (bodyBuffer && bodyBuffer.length > 0) {
          req.emit("data", bodyBuffer);
        }
        req.emit("end");
      });
    }
    return res;
  };

  return req;
}

function createNodeRes(resolveResponse) {
  const headers = new Headers();
  let statusCode = 200;
  const chunks = [];
  let finished = false;

  return {
    setHeader(name, value) {
      if (Array.isArray(value)) {
        headers.delete(name);
        value.forEach(v => headers.append(name, String(v)));
      } else {
        headers.set(name, String(value));
      }
    },
    getHeader(name) {
      return headers.get(name);
    },
    writeHead(code, hdrs) {
      statusCode = Number(code) || 200;
      if (hdrs && typeof hdrs === "object") {
        for (const [k, v] of Object.entries(hdrs)) {
          if (v !== undefined) this.setHeader(k, v);
        }
      }
      return this;
    },
    write(chunk) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return true;
    },
    end(chunk) {
      if (finished) return;
      finished = true;
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : null;
      const isNullBodyStatus = statusCode === 204 || statusCode === 304 || (statusCode >= 300 && statusCode < 400 && (!body || body.length === 0));
      resolveResponse(new Response(isNullBodyStatus ? null : body, {
        status: statusCode,
        headers
      }));
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Se la richiesta riguarda i file statici del frontend (index.html, styles.css, app.js, assets)
    // e il binding ASSETS di Cloudflare Workers e attivo, servi direttamente da Cloudflare Edge
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/auth/") && env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (requestHandler.injectRuntimeEnv) {
      requestHandler.injectRuntimeEnv({
        ...env,
        CLOUDFLARE_WORKERS: "1"
      });
    }

    let bodyBuffer = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const ab = await request.arrayBuffer();
      bodyBuffer = Buffer.from(ab);
    }

    return new Promise((resolve, reject) => {
      const req = toNodeReq(request, bodyBuffer, url);
      const res = createNodeRes(resolve);
      Promise.resolve(requestHandler(req, res)).catch(err => {
        console.error("[Cloudflare Worker Error]", err);
        reject(err);
      });
    });
  },

  async scheduled(event, env, ctx) {
    const romeHourStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      hour12: false
    }).format(new Date());
    const romeHour = Number(romeHourStr) === 24 ? 0 : Number(romeHourStr);

    if (event && event.cron === "0 16,17 * * *" && romeHour !== 18) {
      console.log(`[Cloudflare Cron] Trigger ignorato: ora italiana attuale ${romeHour}:00 (esecuzione programmata alle 18:00)`);
      return;
    }

    if (requestHandler.runScheduledCron) {
      const promise = requestHandler.runScheduledCron({
        ...env,
        CLOUDFLARE_WORKERS: "1"
      });
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(promise);
      } else {
        await promise;
      }
    }
  }
};
