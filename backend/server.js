const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const http = require("http");
const https = require("https");
const net = require("net");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const WebSocket = require("ws");

const config = require("./config");
const runtime = require("./runtime");
const aiAssistant = require("./aiAssistant");

const app = express();

function normalizeOrigin(value) {
  return String(value || "").replace(/\/+$/u, "");
}

const configuredCorsOrigins = new Set(
  (Array.isArray(config.security?.corsOrigins)
    ? config.security.corsOrigins
    : []
  )
    .map(normalizeOrigin)
    .filter(Boolean),
);

function isAllowedCorsOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return true;
  }
  return configuredCorsOrigins.has(normalized);
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: true,
  }),
);

function isTrustedRequestOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin);
  if (!origin) {
    return true;
  }
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const requestHost = forwardedHost || req.headers.host || "";
  try {
    const originUrl = new URL(origin);
    if (requestHost && originUrl.host === requestHost) {
      return true;
    }
  } catch (_error) {
    return false;
  }
  return isAllowedCorsOrigin(origin);
}

function requireTrustedRequestOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (isTrustedRequestOrigin(req)) {
    next();
    return;
  }
  sendError(res, 403, 403, "Untrusted request origin");
}

app.use(requireTrustedRequestOrigin);
app.use(bodyParser.json({ limit: "25mb" }));
app.use(bodyParser.urlencoded({ extended: true }));

const dataRoot = path.resolve(config.baseMapRoot, "..");
const importTmpRoot = path.join(dataRoot, "import_tmp");
const runtimeJobRoot = path.join(dataRoot, "runtime_jobs");
const chunkUploadRoot = path.join(dataRoot, "chunk_uploads");
fs.mkdirSync(importTmpRoot, { recursive: true });
fs.mkdirSync(runtimeJobRoot, { recursive: true });
fs.mkdirSync(chunkUploadRoot, { recursive: true });
const upload = multer({
  dest: importTmpRoot,
  limits: {
    fileSize: config.uploadFileSizeBytes,
  },
});
const DATA_PACKAGE_CHUNK_SIZE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAPEDITOR_UPLOAD_CHUNK_SIZE_BYTES) || 8 * 1024 * 1024,
);

if (fs.existsSync(config.frontendBuildRoot)) {
  app.use(express.static(config.frontendBuildRoot));
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/plugins/map" });
const existingUpgradeListeners = server.listeners("upgrade");
server.removeAllListeners("upgrade");

let lastAccessedBaseMapDir = null;
const authSessions = new Map();
const AUTH_COOKIE_NAME = "mapeditor_session";

const BASE_MAP_LAYER_DIRS = {
  rgb_ortho: "map_images_rgb_ortho",
  enhanced: "map_images",
  raw: "map_images_raw",
  ground: "map_images_ground",
  marking: "map_images_marking",
  edge: "map_images_edge",
  structure: "map_images_structure",
};
const APOLLO_TARGET_CRS = {
  datum: "WGS84",
  projection: "UTM",
  zone: 50,
  hemisphere: "north",
  epsg: "EPSG:32650",
  proj4: "+proj=utm +zone=50 +datum=WGS84 +units=m +no_defs",
  unit: "meter",
};
const GAUSS_KRUGER_CM114_CRS = {
  datum: "CGCS2000/WGS84-compatible",
  projection: "Transverse_Mercator",
  centralMeridianDeg: 114,
  latitudeOfOriginDeg: 0,
  scaleFactor: 1,
  falseEastingMeters: 500000,
  falseNorthingMeters: 0,
  unit: "meter",
};

function getBaseMapLayerDir(layer = "enhanced") {
  return BASE_MAP_LAYER_DIRS[layer] || null;
}
const runtimeJobs = new Map();
const editorMapLocks = new Map();
let websocketClientSeq = 0;
let dreamviewAutoHealPromise = null;
let lastDreamviewAutoHealAt = 0;
const DREAMVIEW_AUTO_HEAL_COOLDOWN_MS = 30 * 1000;
const HEAVY_RUNTIME_JOB_TYPES = new Set([
  "import-data-package-base-map",
  "import-data-packages-merged-base-map",
  "sync-capture-source-package",
  "sync-capture-source-packages",
  "prebuild-data-package-base-maps",
  "stage-apollolite-map",
  "repair-apollolite-runtime",
  "deploy-map",
  "deploy-latest",
  "rollback-deployment",
]);

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sendSuccess(res, data, options = {}) {
  const payload = {
    code: 0,
    message: options.message || "Success",
  };
  if (typeof data !== "undefined") {
    payload.data = data;
  }
  res.status(options.status || 200).json(payload);
}

function sendError(res, status, code, message, data) {
  const payload = {
    code,
    message,
  };
  if (typeof data !== "undefined") {
    payload.data = data;
  }
  res.status(status).json(payload);
}

function redactSecret(value) {
  return value ? "***" : "";
}

function buildPublicConfigPayload() {
  return {
    port: config.port,
    baseMapRoot: config.baseMapRoot,
    editorMapRoot: config.editorMapRoot,
    releaseRoot: config.releaseRoot,
    converterBinary: config.converterBinary,
    converterAvailable: fs.existsSync(config.converterBinary),
    frontendBuildRoot: config.frontendBuildRoot,
    frontendAvailable: fs.existsSync(config.frontendBuildRoot),
    runtimeMode: config.runtimeMode,
    runtimeDockerContainer: config.runtimeDockerContainer,
    edgeDeploy: {
      ...runtime.getDeployConfig(config),
      password: redactSecret(config.edgeDeploy?.password),
    },
    apolloLite: {
      ...config.apolloLite,
    },
    security: {
      corsOrigins: Array.from(configuredCorsOrigins),
    },
  };
}

function summarizePreflightErrors(preflight) {
  const errors = Array.isArray(preflight?.checks)
    ? preflight.checks.filter((check) => check.status === "error")
    : [];
  if (errors.length === 0) {
    return "";
  }
  const summary = errors
    .slice(0, 3)
    .map((check) => `${check.name}: ${check.message}`)
    .join("; ");
  return errors.length > 3 ? `${summary}; +${errors.length - 3} more` : summary;
}

function clipText(value, maxLength = 4000) {
  return String(value || "").slice(0, maxLength);
}

function normalizeAssistantContext(rawContext = {}) {
  const summary = rawContext.summary || {};
  const selectedElements = Array.isArray(rawContext.selectedElements)
    ? rawContext.selectedElements
    : [];
  const topIssues = Array.isArray(rawContext.topIssues)
    ? rawContext.topIssues
    : [];
  return {
    mapName: clipText(rawContext.mapName, 120),
    summary: {
      lanes: Number(summary.lanes) || 0,
      laneEdges: Number(summary.laneEdges) || 0,
      laneComponents: Number(summary.laneComponents) || 0,
      errors: Number(summary.errors) || 0,
      warnings: Number(summary.warnings) || 0,
    },
    selectedElements: selectedElements.slice(0, 12).map((item) => ({
      id: clipText(item.id, 80),
      type: clipText(item.type, 80),
      threeObject: clipText(item.threeObject, 80),
      lane: item.lane
        ? {
            id: clipText(item.lane.id, 80),
            speed: item.lane.speed,
            direction: item.lane.direction,
            possibleDirection: item.lane.possibleDirection,
            trend: item.lane.trend,
            width: item.lane.width,
            leftBoundaryId: clipText(item.lane.leftBoundaryId, 80),
            rightBoundaryId: clipText(item.lane.rightBoundaryId, 80),
          }
        : undefined,
    })),
    topIssues: topIssues.slice(0, 20).map((issue) => ({
      severity: issue.severity === "error" ? "error" : "warning",
      title: clipText(issue.title, 160),
      suggestion: clipText(issue.suggestion, 260),
      details: Array.isArray(issue.details)
        ? issue.details.slice(0, 6).map((detail) => clipText(detail, 180))
        : [],
      target: issue.target
        ? {
            type: clipText(issue.target.type, 80),
            id: clipText(issue.target.id, 80),
            boundaryIds: Array.isArray(issue.target.boundaryIds)
              ? issue.target.boundaryIds
                  .slice(0, 4)
                  .map((id) => clipText(id, 80))
              : [],
          }
        : undefined,
    })),
  };
}

function buildLocalMapAssistantReply(question, context) {
  const { summary, selectedElements, topIssues, mapName } = context;
  const blockers = topIssues.filter((issue) => issue.severity === "error");
  const warnings = topIssues.filter((issue) => issue.severity !== "error");
  const selectedText =
    selectedElements.length > 0
      ? selectedElements
          .map((item) => {
            if (item.lane) {
              return `车道 ${item.lane.id}，速度 ${item.lane.speed}，宽度 ${Number(item.lane.width || 0).toFixed(2)}m`;
            }
            return `${item.type || item.threeObject || "对象"} ${item.id || ""}`.trim();
          })
          .join("；")
      : "当前没有选中对象";
  const lowerQuestion = String(question || "").toLowerCase();
  const lines = [];

  lines.push(
    `我已读取当前地图${mapName ? `「${mapName}」` : ""}的质检上下文。`,
  );
  lines.push(
    `概况：${summary.lanes} 条车道，${summary.laneEdges} 条连接，${summary.laneComponents} 个拓扑区域，${summary.errors} 个错误，${summary.warnings} 个警告。`,
  );
  lines.push(`选中对象：${selectedText}。`);

  if (blockers.length > 0) {
    lines.push("");
    lines.push("优先处理这些阻断项：");
    blockers.slice(0, 5).forEach((issue, index) => {
      lines.push(`${index + 1}. ${issue.title}`);
      if (issue.suggestion) {
        lines.push(`   建议：${issue.suggestion}`);
      }
      (issue.details || [])
        .slice(0, 3)
        .forEach((detail) => lines.push(`   ${detail}`));
    });
  } else if (warnings.length > 0) {
    lines.push("");
    lines.push("当前没有阻断错误，剩余主要是发布前需要确认的警告：");
    warnings.slice(0, 5).forEach((issue, index) => {
      lines.push(`${index + 1}. ${issue.title}`);
      if (issue.suggestion) {
        lines.push(`   建议：${issue.suggestion}`);
      }
    });
  } else {
    lines.push("");
    lines.push("当前质检没有发现阻断项，可以进入发布和仿真验证。");
  }

  if (
    lowerQuestion.includes("环岛") ||
    lowerQuestion.includes("半径") ||
    lowerQuestion.includes("弯")
  ) {
    lines.push("");
    lines.push(
      "弯道/环岛判断原则：2m 以下仍按硬错误处理；2m 到 3m 的低速曲线车道按警告处理，并交给发布转换器尝试平滑；4.5m 以下仍建议在 Dreamview 里做低速通过验证。",
    );
  }

  if (
    lowerQuestion.includes("12") ||
    lowerQuestion.includes("优化") ||
    lowerQuestion.includes("稳定")
  ) {
    lines.push("");
    lines.push(
      "今晚的 12 轮优化建议按这个顺序推进：工具基线、弯道连接、直道连接、质检分层、发布回显、AI 诊断、AI 修复确认、渲染性能、交互提示、拓扑可视化、回归样例、发布历史。当前已覆盖：质检分层、弯道阈值、AI 诊断入口。",
    );
  }

  lines.push("");
  lines.push(
    "下一步建议：先在“质检”页逐个定位红色错误；如果只剩黄色警告，再发布并看发布结果里的平滑/限速提示。",
  );
  return lines.join("\n");
}

function parseOpenAIResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function postOpenAIResponse(requestPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  const apiUrl = new URL(
    process.env.OPENAI_RESPONSES_URL || "https://api.openai.com/v1/responses",
  );
  const body = JSON.stringify(requestPayload);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        hostname: apiUrl.hostname,
        path: `${apiUrl.pathname}${apiUrl.search}`,
        port: apiUrl.port || 443,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let payload;
          try {
            payload = JSON.parse(raw);
          } catch (error) {
            reject(
              new Error(`OpenAI response parse failed: ${raw.slice(0, 300)}`),
            );
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                payload?.error?.message ||
                  `OpenAI request failed: ${response.statusCode}`,
              ),
            );
            return;
          }
          resolve(payload);
        });
      },
    );
    req.setTimeout(Number(process.env.MAP_AI_TIMEOUT_MS || 25000), () => {
      req.destroy(new Error("OpenAI request timeout"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sendAcceptedJob(res, job) {
  sendSuccess(
    res,
    {
      job: serializeRuntimeJob(job),
    },
    {
      status: 202,
      message: "Accepted",
    },
  );
}

function sendRuntimeJobNotFound(res, jobId) {
  sendError(res, 404, 404, `job not found: ${jobId}`);
}

function parseCookies(cookieHeader = "") {
  return String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }
      const key = decodeURIComponent(part.slice(0, separatorIndex));
      const value = decodeURIComponent(part.slice(separatorIndex + 1));
      return {
        ...cookies,
        [key]: value,
      };
    }, {});
}

function getAuthUserFromRequest(req) {
  if (!config.auth?.enabled) {
    return {
      username: config.auth?.username || "admin",
      role: config.auth?.role || "admin",
      authEnabled: false,
    };
  }
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies[AUTH_COOKIE_NAME];
  const session = sessionId ? authSessions.get(sessionId) : null;
  if (!session) {
    return null;
  }
  if (Date.now() > session.expiresAt) {
    authSessions.delete(sessionId);
    return null;
  }
  return {
    username: session.username,
    role: session.role,
    authEnabled: true,
  };
}

function buildPermissionsForRole(role) {
  return {
    canView: true,
    canEdit: ["admin", "operator"].includes(role),
    canDeploy: role === "admin",
    canAdmin: role === "admin",
  };
}

function buildAuthSessionPayload(req) {
  const user = getAuthUserFromRequest(req);
  return {
    authEnabled: config.auth?.enabled === true,
    authenticated: Boolean(user),
    user,
    permissions: user ? buildPermissionsForRole(user.role) : null,
  };
}

function setAuthCookie(res, sessionId, expiresAt) {
  const maxAgeSeconds = Math.max(
    60,
    Math.floor((expiresAt - Date.now()) / 1000),
  );
  res.cookie(AUTH_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: maxAgeSeconds * 1000,
  });
}

function safeCompareText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requireAuth(req, res, next) {
  if (req.path.startsWith("/runtime/auth/")) {
    next();
    return;
  }
  if (!config.auth?.enabled || getAuthUserFromRequest(req)) {
    next();
    return;
  }
  res.status(401).json({
    code: 401,
    message: "Authentication required",
  });
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!config.auth?.enabled) {
      next();
      return;
    }
    const user = getAuthUserFromRequest(req);
    const permissions = user ? buildPermissionsForRole(user.role) : null;
    if (permissions?.[permission]) {
      next();
      return;
    }
    sendError(res, 403, 403, "Permission denied");
  };
}

function getDreamviewProxyTarget() {
  const target =
    config.apolloLite?.dreamviewProxyTarget || "http://127.0.0.1:8888";
  return new URL(target);
}

function buildDreamviewProxyPath(originalUrl = "/") {
  const stripped = originalUrl.replace(/^\/dreamview(?=\/|$)/u, "") || "/";
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function isExpectedSocketClose(error) {
  return error?.code === "EPIPE" || error?.code === "ECONNRESET";
}

function isDreamviewConnectionFailure(error) {
  const message = String(error?.message || "");
  return (
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error?.code) ||
    /socket hang up|connect/i.test(message)
  );
}

function triggerDreamviewAutoHeal(reason) {
  if (
    !config.apolloLite?.enabled ||
    typeof runtime.repairApolloLiteRuntime !== "function"
  ) {
    return null;
  }
  if (dreamviewAutoHealPromise) {
    return dreamviewAutoHealPromise;
  }
  const now = Date.now();
  if (now - lastDreamviewAutoHealAt < DREAMVIEW_AUTO_HEAL_COOLDOWN_MS) {
    return null;
  }
  lastDreamviewAutoHealAt = now;
  log(`[dreamview:autoheal] triggered: ${reason}`);
  dreamviewAutoHealPromise = runtime
    .repairApolloLiteRuntime(config, (message) => {
      log(`[dreamview:autoheal] ${message}`);
    })
    .then((result) => {
      log(
        `[dreamview:autoheal] completed: ${result?.ready ? "ready" : "needs attention"}`,
      );
      return result;
    })
    .catch((error) => {
      log("[dreamview:autoheal] failed:", error.message);
      return { error: error.message };
    })
    .finally(() => {
      dreamviewAutoHealPromise = null;
    });
  return dreamviewAutoHealPromise;
}

function proxyDreamviewHttp(req, res) {
  const target = getDreamviewProxyTarget();
  const targetPath = buildDreamviewProxyPath(req.originalUrl || req.url);
  const client = target.protocol === "https:" ? https : http;
  const headers = {
    ...req.headers,
    host: target.host,
  };
  delete headers["accept-encoding"];

  const proxyReq = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers,
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode || 502;
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (typeof value !== "undefined") {
          res.setHeader(key, value);
        }
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    const healPromise = isDreamviewConnectionFailure(error)
      ? triggerDreamviewAutoHeal(error.message)
      : null;
    if (!res.headersSent && !res.destroyed) {
      res
        .status(502)
        .send(
          healPromise
            ? `Dreamview proxy failed: ${error.message}. Auto-heal started; refresh in a few seconds.`
            : `Dreamview proxy failed: ${error.message}`,
        );
      return;
    }
    if (!res.destroyed) {
      res.end();
    }
  });
  req.on("aborted", () => {
    proxyReq.destroy();
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      proxyReq.destroy();
    }
  });
  req.pipe(proxyReq);
}

function handleDreamviewUpgrade(req, socket, head) {
  const target = getDreamviewProxyTarget();
  const targetPort = Number(
    target.port || (target.protocol === "https:" ? 443 : 80),
  );
  const targetPath = buildDreamviewProxyPath(req.url || "/");
  const upstream = net.connect(targetPort, target.hostname);
  let connected = false;

  const destroyStream = (stream) => {
    if (!stream.destroyed) {
      stream.destroy();
    }
  };

  const destroyBoth = () => {
    socket.unpipe(upstream);
    upstream.unpipe(socket);
    destroyStream(socket);
    destroyStream(upstream);
  };

  socket.setNoDelay?.(true);
  upstream.setNoDelay?.(true);

  socket.on("error", (error) => {
    if (!isExpectedSocketClose(error)) {
      log("Dreamview websocket client error:", error.message);
    }
    destroyBoth();
  });
  socket.on("close", () => {
    destroyStream(upstream);
  });
  upstream.on("close", () => {
    destroyStream(socket);
  });
  upstream.on("connect", () => {
    connected = true;
    const headerLines = [
      `${req.method} ${targetPath} HTTP/${req.httpVersion}`,
      ...Object.entries(req.headers).map(([key, value]) => {
        const normalizedValue = Array.isArray(value) ? value.join(", ") : value;
        return `${key}: ${key.toLowerCase() === "host" ? target.host : normalizedValue}`;
      }),
      "",
      "",
    ];
    upstream.write(headerLines.join("\r\n"));
    if (head?.length) {
      upstream.write(head);
    }
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", (error) => {
    if (isDreamviewConnectionFailure(error)) {
      triggerDreamviewAutoHeal(error.message);
    } else {
      log("Dreamview websocket proxy failed:", error.message);
    }
    if (!connected && !socket.destroyed) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n", () =>
        destroyStream(socket),
      );
    }
    destroyStream(upstream);
    if (connected) {
      destroyStream(socket);
    }
  });
}

function buildRuntimeJobPath(jobId) {
  return path.join(runtimeJobRoot, `${jobId}.json`);
}

function buildRuntimeJobLogPath(jobId) {
  return path.join(runtimeJobRoot, `${jobId}.log`);
}

function readRuntimeJobLogs(jobId, tail = 200) {
  const logPath = buildRuntimeJobLogPath(jobId);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
  return lines
    .slice(-Math.max(1, Math.min(Number(tail) || 200, 1000)))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return { time: "", level: "info", message: line };
      }
    });
}

function serializeRuntimeJob(job, options = {}) {
  const payload = {
    id: job.id,
    type: job.type,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
    request: job.request || null,
    result: job.result || null,
    error: job.error || null,
    logPath: buildRuntimeJobLogPath(job.id),
  };
  if (options.includeLogs) {
    payload.logs = readRuntimeJobLogs(job.id, options.tail);
  }
  return payload;
}

async function persistRuntimeJob(job) {
  job.updatedAt = new Date().toISOString();
  await fsp.mkdir(runtimeJobRoot, { recursive: true });
  await fsp.writeFile(
    buildRuntimeJobPath(job.id),
    JSON.stringify(serializeRuntimeJob(job), null, 2),
    "utf8",
  );
}

async function appendRuntimeJobLog(job, message, level = "info") {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
  };
  await fsp.mkdir(runtimeJobRoot, { recursive: true });
  await fsp.appendFile(
    buildRuntimeJobLogPath(job.id),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
  job.lastLog = entry;
  await persistRuntimeJob(job);
}

async function updateRuntimeJobProgress(job, message, level = "info") {
  job.message = message;
  await appendRuntimeJobLog(job, message, level);
}

function loadRuntimeJobs() {
  const files = fs
    .readdirSync(runtimeJobRoot)
    .filter((file) => file.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(runtimeJobRoot, file), "utf8");
      const job = JSON.parse(raw);
      if (job.status === "queued" || job.status === "running") {
        job.status = "failed";
        job.message = "Server restarted before the job finished";
        job.error = { message: job.message };
        job.finishedAt = job.finishedAt || new Date().toISOString();
        fs.writeFileSync(
          path.join(runtimeJobRoot, file),
          JSON.stringify(job, null, 2),
          "utf8",
        );
        fs.appendFileSync(
          buildRuntimeJobLogPath(job.id),
          `${JSON.stringify({ time: new Date().toISOString(), level: "error", message: job.message })}\n`,
          "utf8",
        );
      }
      runtimeJobs.set(job.id, job);
    } catch (error) {
      log("Failed to load runtime job:", file, error);
    }
  }
}

function listRuntimeJobs() {
  return Array.from(runtimeJobs.values())
    .map((job) => serializeRuntimeJob(job))
    .sort(
      (left, right) => new Date(right.createdAt) - new Date(left.createdAt),
    );
}

function isActiveRuntimeJob(job) {
  return job?.status === "queued" || job?.status === "running";
}

function findActiveHeavyRuntimeJob() {
  for (const job of runtimeJobs.values()) {
    if (isActiveRuntimeJob(job) && HEAVY_RUNTIME_JOB_TYPES.has(job.type)) {
      return job;
    }
  }
  return null;
}

function sendRuntimeJobBusy(res, activeJob) {
  sendError(
    res,
    409,
    15066,
    `A runtime production job is already running: ${activeJob.id}`,
    {
      job: serializeRuntimeJob(activeJob),
    },
  );
}

function buildCaptureAutoSyncRequest(trigger = "auto") {
  const options = config.captureAutoSync || {};
  return {
    trigger,
    onlyNew: true,
    overwrite: false,
    limit: Number(options.limit) || 50,
    minAgeMinutes: Number(options.minAgeMinutes) || 15,
    autoGenerateBaseMaps: options.autoGenerateBaseMaps !== false,
    maxBaseMapJobs: Number(options.maxBaseMapJobs) || 20,
    autoMerge: options.autoMerge !== false,
    mergedMapName: options.mergedMapName || "capture_source_merged",
    overwriteBaseMaps: false,
    overwriteMergedMap: true,
  };
}

function startCaptureAutoSyncJob(trigger = "auto") {
  if (!config.captureAutoSync?.enabled) {
    return null;
  }
  if (!config.captureSourceRoot || !fs.existsSync(config.captureSourceRoot)) {
    log(
      "Capture auto sync skipped: source root is not configured or not mounted",
    );
    return null;
  }
  const activeJob = findActiveHeavyRuntimeJob();
  if (activeJob) {
    log(`Capture auto sync skipped: active heavy job ${activeJob.id}`);
    return null;
  }
  const request = buildCaptureAutoSyncRequest(trigger);
  const job = startRuntimeJob(
    "sync-capture-source-packages",
    (runtimeJob) =>
      runtime.syncCaptureSourcePackages(config, {
        ...request,
        progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
      }),
    request,
  );
  log(`Capture auto sync started: ${job.id}`);
  return job;
}

function startCaptureAutoSyncScheduler() {
  if (!config.captureAutoSync?.enabled) {
    return;
  }
  const intervalMs =
    Math.max(5, Number(config.captureAutoSync.intervalMinutes) || 30) *
    60 *
    1000;
  setTimeout(() => startCaptureAutoSyncJob("startup"), 15000);
  setInterval(() => startCaptureAutoSyncJob("interval"), intervalMs);
  log(
    `Capture auto sync scheduler enabled; interval=${Math.round(intervalMs / 60000)}m`,
  );
}

function buildInboxAutoPrebuildRequest(trigger = "auto") {
  const options = config.inboxAutoPrebuild || {};
  return {
    trigger,
    maxAnalysisJobs: Number(options.maxAnalysisJobs) || 20,
    maxBaseMapJobs: Number(options.maxBaseMapJobs) || 20,
    autoMerge: options.autoMerge !== false,
    mergedMapName: options.mergedMapName || "capture_inbox_merged",
    overwriteBaseMaps: false,
    overwriteMergedMap: false,
  };
}

function startInboxAutoPrebuildJob(trigger = "auto") {
  if (!config.inboxAutoPrebuild?.enabled) {
    return null;
  }
  const activeJob = findActiveHeavyRuntimeJob();
  if (activeJob) {
    log(`Inbox auto prebuild skipped: active heavy job ${activeJob.id}`);
    return null;
  }
  const request = buildInboxAutoPrebuildRequest(trigger);
  const job = startRuntimeJob(
    "prebuild-data-package-base-maps",
    (runtimeJob) =>
      runtime.prebuildDataPackageBaseMaps(config, {
        ...request,
        progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
      }),
    request,
  );
  log(`Inbox auto prebuild started: ${job.id}`);
  return job;
}

function startInboxAutoPrebuildScheduler() {
  if (!config.inboxAutoPrebuild?.enabled) {
    return;
  }
  const intervalMs =
    Math.max(5, Number(config.inboxAutoPrebuild.intervalMinutes) || 10) *
    60 *
    1000;
  setTimeout(() => startInboxAutoPrebuildJob("startup"), 20000);
  setInterval(() => startInboxAutoPrebuildJob("interval"), intervalMs);
  log(
    `Inbox auto prebuild scheduler enabled; interval=${Math.round(intervalMs / 60000)}m`,
  );
}

async function removeRuntimeJobFiles(jobId) {
  await Promise.all([
    fsp.rm(buildRuntimeJobPath(jobId), { force: true }),
    fsp.rm(buildRuntimeJobLogPath(jobId), { force: true }),
  ]);
}

function sanitizeUploadFileName(name, index) {
  const base = path
    .basename(String(name || `upload-${index}`))
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
  return `${index}-${base || "upload"}`;
}

function sanitizeUploadSessionId(sessionId) {
  const value = String(sessionId || "").trim();
  if (!/^[a-z0-9-]+$/u.test(value)) {
    throw new Error("非法上传会话");
  }
  return value;
}

function buildUploadSessionId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString("hex")}`;
}

function getChunkUploadSessionDir(sessionId) {
  return path.join(chunkUploadRoot, sanitizeUploadSessionId(sessionId));
}

function getChunkUploadSessionPath(sessionId) {
  return path.join(getChunkUploadSessionDir(sessionId), "session.json");
}

async function readChunkUploadSession(sessionId) {
  const sessionPath = getChunkUploadSessionPath(sessionId);
  const raw = await fsp.readFile(sessionPath, "utf8");
  return JSON.parse(raw);
}

async function writeChunkUploadSession(session) {
  session.updatedAt = new Date().toISOString();
  await fsp.mkdir(getChunkUploadSessionDir(session.id), { recursive: true });
  await fsp.writeFile(
    getChunkUploadSessionPath(session.id),
    JSON.stringify(session, null, 2),
    "utf8",
  );
}

function normalizeChunkUploadFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files is required");
  }
  if (files.length > 64) {
    throw new Error("一次最多上传 64 个文件");
  }
  return files.map((file, index) => {
    const name = path.basename(String(file?.name || `upload-${index}`));
    const size = Number(file?.size || 0);
    if (!name || name === "." || name === "..") {
      throw new Error(`第 ${index + 1} 个文件名称无效`);
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`${name} 文件大小无效`);
    }
    if (size > config.uploadFileSizeBytes) {
      throw new Error(
        `${name} 超过单文件上传上限 ${formatBytes(config.uploadFileSizeBytes)}`,
      );
    }
    return {
      name,
      size,
      type: String(file?.type || ""),
      lastModified: Number(file?.lastModified || 0) || null,
      chunkCount: Math.max(1, Math.ceil(size / DATA_PACKAGE_CHUNK_SIZE_BYTES)),
      uploadedChunks: [],
    };
  });
}

function getChunkUploadPartPath(sessionId, fileIndex, chunkIndex) {
  return path.join(
    getChunkUploadSessionDir(sessionId),
    "chunks",
    String(fileIndex),
    `${chunkIndex}.part`,
  );
}

function assertChunkUploadIndex(session, fileIndex, chunkIndex) {
  const normalizedFileIndex = Number(fileIndex);
  const normalizedChunkIndex = Number(chunkIndex);
  if (
    !Number.isInteger(normalizedFileIndex) ||
    normalizedFileIndex < 0 ||
    normalizedFileIndex >= session.files.length
  ) {
    throw new Error("文件索引无效");
  }
  const file = session.files[normalizedFileIndex];
  if (
    !Number.isInteger(normalizedChunkIndex) ||
    normalizedChunkIndex < 0 ||
    normalizedChunkIndex >= file.chunkCount
  ) {
    throw new Error("分片索引无效");
  }
  return {
    fileIndex: normalizedFileIndex,
    chunkIndex: normalizedChunkIndex,
    file,
  };
}

async function assertChunkUploadComplete(session) {
  for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
    const file = session.files[fileIndex];
    for (let chunkIndex = 0; chunkIndex < file.chunkCount; chunkIndex += 1) {
      const partPath = getChunkUploadPartPath(session.id, fileIndex, chunkIndex);
      if (!(await pathExists(partPath))) {
        throw new Error(`${file.name} 缺少分片 ${chunkIndex + 1}/${file.chunkCount}`);
      }
    }
  }
}

async function appendChunkFileToTarget(partPath, targetPath) {
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(partPath);
    const output = fs.createWriteStream(targetPath, { flags: "a" });
    input.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(output);
  });
}

async function assembleChunkUploadSession(session) {
  await assertChunkUploadComplete(session);
  const stagingId = `chunk-${session.id}`;
  const jobTmpDir = path.join(importTmpRoot, `job-${stagingId}`);
  await fsp.rm(jobTmpDir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(jobTmpDir, { recursive: true });
  const files = [];
  for (let fileIndex = 0; fileIndex < session.files.length; fileIndex += 1) {
    const file = session.files[fileIndex];
    const targetPath = path.join(jobTmpDir, sanitizeUploadFileName(file.name, fileIndex));
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    for (let chunkIndex = 0; chunkIndex < file.chunkCount; chunkIndex += 1) {
      const partPath = getChunkUploadPartPath(session.id, fileIndex, chunkIndex);
      await appendChunkFileToTarget(partPath, targetPath);
    }
    const stat = await fsp.stat(targetPath);
    if (stat.size !== file.size) {
      throw new Error(
        `${file.name} 合并后大小不一致：应为 ${formatBytes(file.size)}，实际 ${formatBytes(stat.size)}`,
      );
    }
    files.push({
      path: targetPath,
      originalName: file.name,
      size: file.size,
    });
  }
  await validateUploadedFiles(
    files.map((file) => ({
      path: file.path,
      originalname: file.originalName,
      size: file.size,
    })),
  );
  return {
    jobTmpDir,
    files,
  };
}

function formatBytes(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(
    Math.floor(Math.log(numberValue) / Math.log(1024)),
    units.length - 1,
  );
  return `${(numberValue / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

async function assertZipHasEndOfCentralDirectory(filePath, displayName) {
  const stat = await fsp.stat(filePath);
  const minZipSize = 22;
  if (stat.size < minZipSize) {
    throw new Error(
      `ZIP 文件不完整：${displayName} 只有 ${formatBytes(stat.size)}，请重新打包后上传。`,
    );
  }
  const maxCommentBytes = 65535;
  const readSize = Math.min(stat.size, minZipSize + maxCommentBytes);
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, stat.size - readSize);
    for (let index = buffer.length - minZipSize; index >= 0; index -= 1) {
      if (
        buffer[index] === 0x50 &&
        buffer[index + 1] === 0x4b &&
        buffer[index + 2] === 0x05 &&
        buffer[index + 3] === 0x06
      ) {
        return;
      }
    }
  } finally {
    await handle.close();
  }
  throw new Error(
    `ZIP 文件尾部不完整或不是标准 ZIP：${displayName}。服务器收到 ${formatBytes(
      stat.size,
    )}，但没有找到中央目录结束标记。请确认上传没有中断、不是分卷 ZIP，并重新打包上传。`,
  );
}

async function validateUploadedFiles(uploadedFiles) {
  for (const file of uploadedFiles) {
    if (!file?.path) {
      continue;
    }
    const stat = await fsp.stat(file.path);
    if (file.size && stat.size !== file.size) {
      throw new Error(
        `上传文件大小不一致：${file.originalname || file.filename}，浏览器报告 ${formatBytes(
          file.size,
        )}，服务器收到 ${formatBytes(stat.size)}。请重新上传。`,
      );
    }
    if (
      path.extname(file.originalname || file.filename || "").toLowerCase() ===
      ".zip"
    ) {
      await assertZipHasEndOfCentralDirectory(
        file.path,
        file.originalname || file.filename || file.path,
      );
    }
  }
}

async function moveUploadedFilesToJobDir(jobId, uploadedFiles) {
  const jobTmpDir = path.join(importTmpRoot, `job-${jobId}`);
  await fsp.mkdir(jobTmpDir, { recursive: true });
  const files = [];
  for (let index = 0; index < uploadedFiles.length; index += 1) {
    const file = uploadedFiles[index];
    const targetPath = path.join(
      jobTmpDir,
      sanitizeUploadFileName(file.originalname, index),
    );
    try {
      await fsp.rename(file.path, targetPath);
    } catch (_error) {
      await fsp.copyFile(file.path, targetPath);
      await fsp.unlink(file.path).catch(() => {});
    }
    files.push({
      path: targetPath,
      originalName: file.originalname,
    });
  }
  return {
    jobTmpDir,
    files,
  };
}

function pruneRuntimeJobs() {
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (const [jobId, job] of runtimeJobs.entries()) {
    const finishedAt = job.finishedAt
      ? new Date(job.finishedAt).getTime()
      : null;
    if (finishedAt && now - finishedAt > maxAgeMs) {
      runtimeJobs.delete(jobId);
      removeRuntimeJobFiles(jobId).catch(() => {});
    }
  }
}

function startRuntimeJob(type, runner, request = null) {
  pruneRuntimeJobs();
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type,
    status: "queued",
    message: "Queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    request,
    result: null,
    error: null,
  };
  runtimeJobs.set(job.id, job);
  persistRuntimeJob(job).catch((error) =>
    log(`Persist runtime job ${job.id} failed:`, error),
  );
  appendRuntimeJobLog(job, "Queued").catch(() => {});
  setImmediate(async () => {
    job.status = "running";
    job.message = "Running";
    job.startedAt = new Date().toISOString();
    await appendRuntimeJobLog(job, "Running");
    try {
      job.result = await runner(job);
      job.status = "succeeded";
      job.message = "Success";
      await appendRuntimeJobLog(job, "Success");
    } catch (error) {
      log(`Runtime job ${job.id} failed:`, error);
      job.status = "failed";
      job.message = error.message;
      job.error = {
        message: error.message,
      };
      if (error.result) {
        job.result = error.result;
      }
      await appendRuntimeJobLog(job, error.message, "error");
    } finally {
      job.finishedAt = new Date().toISOString();
      await persistRuntimeJob(job);
    }
  });
  return job;
}

loadRuntimeJobs();

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

async function ensureDir(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

async function listBaseMaps() {
  try {
    const entries = await fsp.readdir(config.baseMapRoot, {
      withFileTypes: true,
    });
    const results = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const mapName = entry.name;
      const tileJson = path.join(
        config.baseMapRoot,
        mapName,
        "map_images",
        "tiles.json",
      );
      const rgbOrthoTileJson = path.join(
        config.baseMapRoot,
        mapName,
        "map_images_rgb_ortho",
        "tiles.json",
      );
      const pointCloudIndex = path.join(
        config.baseMapRoot,
        mapName,
        "point_cloud",
        "index.json",
      );
      if ((await pathExists(rgbOrthoTileJson)) || (await pathExists(pointCloudIndex)) || (await pathExists(tileJson))) {
        results.push(mapName);
      }
    }
    results.sort();
    return results;
  } catch (error) {
    log("Failed to list base maps:", error);
    return [];
  }
}

async function listEditorMaps() {
  try {
    await ensureDir(config.editorMapRoot);
    const entries = await fsp.readdir(config.editorMapRoot, {
      withFileTypes: true,
    });
    const results = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        results.push(entry.name.replace(/\.json$/i, ""));
      }
    }
    results.sort();
    return results;
  } catch (error) {
    log("Failed to list editor maps:", error);
    return [];
  }
}

function normalizeEditorMapName(mapName) {
  const name = String(mapName || "").trim();
  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    name.startsWith(".")
  ) {
    throw new Error(`非法地图名称: ${mapName || ""}`);
  }
  return name;
}

function buildEditorMapPath(mapName) {
  return path.join(
    config.editorMapRoot,
    `${normalizeEditorMapName(mapName)}.json`,
  );
}

function buildEditorMapHistoryDir(mapName) {
  return path.join(
    config.editorMapRoot,
    ".history",
    normalizeEditorMapName(mapName),
  );
}

async function loadEditorMap(mapName) {
  const filePath = buildEditorMapPath(mapName);
  const content = await fsp.readFile(filePath, "utf8");
  const map = JSON.parse(content);
  const binding = await stampEditorMapBaseMapBinding(mapName, map);
  return binding.map;
}

function coordinateFromAny(value) {
  if (!value) {
    return null;
  }
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value.position || value;
  const x = Number(source.x ?? source.lng ?? source.lon ?? source.longitude);
  const y = Number(source.y ?? source.lat ?? source.latitude);
  const z = Number(source.z ?? source.height ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, z } : null;
}

function coordinateDistanceMeters(left, right) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.hypot(Number(left.x) - Number(right.x), Number(left.y) - Number(right.y));
}

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E_SQ = WGS84_F * (2 - WGS84_F);
const WGS84_E_PRIME_SQ = WGS84_E_SQ / (1 - WGS84_E_SQ);

function forwardTransverseMercator(lon, lat, crs, z = 0) {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lonOriginRad = (crs.centralMeridianDeg * Math.PI) / 180;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E_SQ * Math.sin(latRad) * Math.sin(latRad));
  const t = Math.tan(latRad) * Math.tan(latRad);
  const c = WGS84_E_PRIME_SQ * Math.cos(latRad) * Math.cos(latRad);
  const aa = Math.cos(latRad) * (lonRad - lonOriginRad);
  const m =
    WGS84_A *
    ((1 - WGS84_E_SQ / 4 - (3 * WGS84_E_SQ ** 2) / 64 - (5 * WGS84_E_SQ ** 3) / 256) * latRad -
      ((3 * WGS84_E_SQ) / 8 + (3 * WGS84_E_SQ ** 2) / 32 + (45 * WGS84_E_SQ ** 3) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * WGS84_E_SQ ** 2) / 256 + (45 * WGS84_E_SQ ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * WGS84_E_SQ ** 3) / 3072) * Math.sin(6 * latRad));
  return {
    x:
      crs.falseEastingMeters +
      crs.scaleFactor *
        n *
        (aa + ((1 - t + c) * aa ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_E_PRIME_SQ) * aa ** 5) / 120),
    y:
      (crs.falseNorthingMeters || 0) +
      crs.scaleFactor *
        (m +
          n *
            Math.tan(latRad) *
            ((aa * aa) / 2 +
              ((5 - t + 9 * c + 4 * c * c) * aa ** 4) / 24 +
              ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_E_PRIME_SQ) * aa ** 6) / 720)),
    z,
  };
}

function inverseTransverseMercator(x, y, crs, z = 0) {
  const e1 = (1 - Math.sqrt(1 - WGS84_E_SQ)) / (1 + Math.sqrt(1 - WGS84_E_SQ));
  const adjustedX = x - crs.falseEastingMeters;
  const adjustedY = y - (crs.falseNorthingMeters || 0);
  const m = adjustedY / crs.scaleFactor;
  const mu = m / (WGS84_A * (1 - WGS84_E_SQ / 4 - (3 * WGS84_E_SQ ** 2) / 64 - (5 * WGS84_E_SQ ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = WGS84_E_PRIME_SQ * Math.cos(phi1) * Math.cos(phi1);
  const t1 = Math.tan(phi1) * Math.tan(phi1);
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E_SQ * Math.sin(phi1) * Math.sin(phi1));
  const r1 = (WGS84_A * (1 - WGS84_E_SQ)) / (1 - WGS84_E_SQ * Math.sin(phi1) * Math.sin(phi1)) ** 1.5;
  const d = adjustedX / (n1 * crs.scaleFactor);
  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_E_PRIME_SQ) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * WGS84_E_PRIME_SQ - 3 * c1 * c1) * d ** 6) / 720);
  const lon =
    (crs.centralMeridianDeg * Math.PI) / 180 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * WGS84_E_PRIME_SQ + 24 * t1 * t1) * d ** 5) / 120) /
      Math.cos(phi1);
  return {
    lon: (lon * 180) / Math.PI,
    lat: (lat * 180) / Math.PI,
    z,
  };
}

function wgs84LonLatToApolloUtm(lon, lat, z = 0) {
  return forwardTransverseMercator(lon, lat, {
    ...APOLLO_TARGET_CRS,
    scaleFactor: 0.9996,
    centralMeridianDeg: 117,
    falseEastingMeters: 500000,
    falseNorthingMeters: 0,
  }, z);
}

function projectCoordinateToApollo(point, sourceCrs) {
  if (!point) {
    return null;
  }
  if (sourceCrs === "APOLLO_UTM_ZONE_50") {
    return point;
  }
  if (sourceCrs === "GAUSS_KRUGER_CM114") {
    const lonLat = inverseTransverseMercator(point.x, point.y, GAUSS_KRUGER_CM114_CRS, point.z || 0);
    return wgs84LonLatToApolloUtm(lonLat.lon, lonLat.lat, point.z || 0);
  }
  if (sourceCrs === "WGS84_LON_LAT") {
    return wgs84LonLatToApolloUtm(point.x, point.y, point.z || 0);
  }
  return null;
}

function getEditorMapBaseCenter(map) {
  return coordinateFromAny(map?.basemapCenter || map?.baseMapCenter || map?.base_map_center);
}

function getEditorMapApolloAnchor(map) {
  const anchor = map?.anchor || map?.coordinateAnchor || map?.coordinate_anchor || map?.coordinateMetadata?.anchor;
  const anchorCoordinate =
    coordinateFromAny(anchor?.utm) ||
    coordinateFromAny(anchor?.apolloUtm) ||
    coordinateFromAny(anchor?.apollo_utm) ||
    coordinateFromAny(anchor?.origin);
  const direct =
    coordinateFromAny(map?.apolloOrigin) ||
    coordinateFromAny(map?.apollo_origin) ||
    coordinateFromAny(map?.utmOrigin) ||
    coordinateFromAny(map?.utm_origin) ||
    coordinateFromAny(map?.mapOrigin) ||
    coordinateFromAny(map?.map_origin);
  if (direct) {
    return {
      coordinate: direct,
      source: anchorCoordinate && coordinateDistanceMeters(anchorCoordinate, direct) <= 0.001
        ? anchor?.source || "apolloOrigin"
        : "apolloOrigin",
    };
  }
  if (anchorCoordinate) {
    return {
      coordinate: anchorCoordinate,
      source: anchor?.source || "anchor.utm",
    };
  }
  const headerOrigin = coordinateFromAny(map?.header?.origin);
  return headerOrigin ? { coordinate: headerOrigin, source: "header.origin" } : null;
}

function editorMapHasUnsafeBaseMapAnchor(map) {
  const anchor = getEditorMapApolloAnchor(map);
  if (!anchor || !/base_map_coordinate_metadata/i.test(String(anchor.source || ""))) {
    return false;
  }
  const rawSourceCrs = normalizeCoordinateFrame(
    map?.coordinateMetadata?.baseMap?.rawPointCloud?.sourceCrs ||
      map?.coordinateMetadata?.rawPointCloud?.sourceCrs ||
      map?.coordinateMetadata?.sourceCrs,
  );
  return !["APOLLO_UTM_ZONE_50", "WGS84_LON_LAT", "GAUSS_KRUGER_CM114"].includes(rawSourceCrs);
}

function stripUnsafeBaseMapAnchor(map) {
  const clean = JSON.parse(JSON.stringify(map || {}));
  delete clean.apolloOrigin;
  delete clean.apollo_origin;
  delete clean.utmOrigin;
  delete clean.utm_origin;
  delete clean.mapOrigin;
  delete clean.map_origin;
  delete clean.anchor;
  delete clean.coordinateAnchor;
  delete clean.coordinate_anchor;
  if (clean.header) {
    delete clean.header.origin;
  }
  if (clean.coordinateMetadata) {
    delete clean.coordinateMetadata.anchor;
  }
  return clean;
}

function normalizeCoordinateFrame(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) {
    return "";
  }
  if (["APOLLO_UTM_ZONE_50", "UTM_ZONE_50", "EPSG:32650", "WGS84_UTM_ZONE_50"].includes(raw)) {
    return "APOLLO_UTM_ZONE_50";
  }
  if (["WGS84_LON_LAT", "WGS84", "EPSG:4326", "LON_LAT", "LONGITUDE_LATITUDE"].includes(raw)) {
    return "WGS84_LON_LAT";
  }
  if (
    [
      "GAUSS_KRUGER_CM114",
      "GAUSS_KRUGER_3_DEGREE_CM114",
      "GK_CM114",
      "CM114",
      "CGCS2000_GK_CM114",
      "CGCS2000_GAUSS_KRUGER_CM114",
      "XIAN80_GK_CM114",
    ].includes(raw)
  ) {
    return "GAUSS_KRUGER_CM114";
  }
  if (["LOCAL_ENU_METERS", "LOCAL_ENU", "LOCAL", "EDITOR_LOCAL", "BASE_MAP_XY"].includes(raw)) {
    return "LOCAL_ENU_METERS";
  }
  return raw;
}

function getEditorMapCoordinateFrame(map) {
  return normalizeCoordinateFrame(
    map?.sourceCrs ||
      map?.source_crs ||
      map?.coordinateFrame ||
      map?.coordinate_frame ||
      map?.coordinateMetadata?.sourceCrs ||
      map?.coordinateMetadata?.source_crs,
  );
}

function coordinateLooksGlobalApollo(point) {
  return Boolean(point && Math.max(Math.abs(Number(point.x)), Math.abs(Number(point.y))) > 100000);
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse((await fsp.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
}

function boundsFromAny(value) {
  if (!value) {
    return null;
  }
  const minX = Number(value.minX ?? value.xMin ?? value.left);
  const maxX = Number(value.maxX ?? value.xMax ?? value.right);
  const minY = Number(value.minY ?? value.yMin ?? value.bottom);
  const maxY = Number(value.maxY ?? value.yMax ?? value.top);
  const minZ = Number(value.minZ ?? value.zMin ?? value.low ?? 0);
  const maxZ = Number(value.maxZ ?? value.zMax ?? value.high ?? 0);
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    return null;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ: Number.isFinite(minZ) ? minZ : 0,
    maxZ: Number.isFinite(maxZ) ? maxZ : 0,
  };
}

function resolveBaseMapDirCandidate(candidate) {
  const value = String(candidate || "").trim();
  if (!value) {
    return null;
  }
  const root = path.resolve(config.baseMapRoot);
  const resolved = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(config.baseMapRoot, normalizeEditorMapName(value));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

async function resolveBaseMapDirForMap(map) {
  const candidates = [
    map?.baseMapDir,
    map?.base_map_dir,
    map?.baseMap,
    map?.base_map,
    map?.baseMapName,
    map?.base_map_name,
  ];
  for (const candidate of candidates) {
    const resolved = (() => {
      try {
        return resolveBaseMapDirCandidate(candidate);
      } catch (_error) {
        return null;
      }
    })();
    if (resolved && (await pathExists(resolved))) {
      return resolved;
    }
  }
  const matchedByCenter = await findBaseMapDirByCenter(getEditorMapBaseCenter(map));
  if (matchedByCenter?.baseMapDir) {
    return matchedByCenter.baseMapDir;
  }
  if (lastAccessedBaseMapDir && (await pathExists(lastAccessedBaseMapDir))) {
    return lastAccessedBaseMapDir;
  }
  return null;
}

async function readBaseMapCoordinateSource(baseMapDir) {
  if (!baseMapDir) {
    return null;
  }
  const sourceFiles = [
    ["point_cloud/index.json", path.join(baseMapDir, "point_cloud", "index.json")],
    ["map_images_rgb_ortho/tiles.json", path.join(baseMapDir, "map_images_rgb_ortho", "tiles.json")],
    ["map_images/tiles.json", path.join(baseMapDir, "map_images", "tiles.json")],
  ];
  for (const [sourceFile, filePath] of sourceFiles) {
    const payload = await readJsonIfExists(filePath).catch((error) => {
      log("Failed to read base-map coordinate metadata:", filePath, error.message);
      return null;
    });
    if (!payload) {
      continue;
    }
    const metadata = payload.coordinateMetadata || null;
    const rawPointCloud = metadata?.rawPointCloud || null;
    const rawSourceCrs = normalizeCoordinateFrame(
      rawPointCloud?.sourceCrs ||
        metadata?.sourceCrs ||
        metadata?.source_crs ||
        payload.sourceCrs ||
        payload.source_crs,
    );
    const rawCenter = coordinateFromAny(rawPointCloud?.center) || coordinateFromAny(payload.center);
    const localOriginInTargetCrs = coordinateFromAny(metadata?.editorLocalFrame?.localOriginInTargetCrs);
    const editorOrigin =
      localOriginInTargetCrs ||
      (rawSourceCrs === "APOLLO_UTM_ZONE_50" ? rawCenter : null);
    return {
      baseMapName: path.basename(baseMapDir),
      baseMapDir,
      sourceFile,
      center: rawCenter || editorOrigin,
      bounds: boundsFromAny(payload.bounds || metadata?.rawPointCloud?.bounds),
      coordinate: payload.coordinate || null,
      coordinateMetadata: metadata,
      editorOrigin,
      rawCenter,
      rawSourceCrs,
      localOriginInTargetCrs,
    };
  }
  return null;
}

async function findBaseMapDirByCenter(baseCenter) {
  if (!baseCenter) {
    return null;
  }
  const maxDistanceMeters = Number(process.env.MAP_BASE_MAP_CENTER_MATCH_METERS || 2);
  const baseMaps = await listBaseMaps();
  let best = null;
  for (const baseMapName of baseMaps) {
    const baseMapDir = path.join(config.baseMapRoot, baseMapName);
    const source = await readBaseMapCoordinateSource(baseMapDir).catch((error) => {
      log("Failed to inspect base-map center:", baseMapDir, error.message);
      return null;
    });
    const center = coordinateFromAny(source?.center) || coordinateFromAny(source?.editorOrigin);
    if (!center) {
      continue;
    }
    const distanceMeters = coordinateDistanceMeters(baseCenter, center);
    if (!Number.isFinite(distanceMeters) || distanceMeters > maxDistanceMeters) {
      continue;
    }
    if (!best || distanceMeters < best.distanceMeters) {
      best = {
        baseMapName,
        baseMapDir,
        sourceFile: source.sourceFile,
        center,
        distanceMeters,
      };
    }
  }
  return best;
}

async function stampEditorMapBaseMapBinding(mapName, map) {
  if (!map || map.baseMapDir || map.base_map_dir || map.baseMapName || map.base_map_name) {
    return { map, matched: null };
  }
  const matched = await findBaseMapDirByCenter(getEditorMapBaseCenter(map));
  if (!matched) {
    return { map, matched: null };
  }
  const stampedMap = JSON.parse(JSON.stringify(map));
  stampedMap.baseMapDir = matched.baseMapName;
  stampedMap.coordinateMetadata = {
    ...(stampedMap.coordinateMetadata || {}),
    baseMap: {
      ...((stampedMap.coordinateMetadata || {}).baseMap || {}),
      name: matched.baseMapName,
      sourceFile: matched.sourceFile,
      center: matched.center,
      matchDistanceMeters: Number(matched.distanceMeters.toFixed(3)),
      matchSource: "basemapCenter",
    },
  };
  log(`Matched base map for ${mapName} by center: ${matched.baseMapName} (${matched.distanceMeters.toFixed(3)}m)`);
  return { map: stampedMap, matched };
}

async function inferBaseMapSourceCrsFromEdgePose(baseMapCoordinate) {
  const rawCenter = coordinateFromAny(baseMapCoordinate?.rawCenter || baseMapCoordinate?.center);
  if (!rawCenter || !config.edgeDeploy?.host || typeof runtime.readEdgeLocalizationPose !== "function") {
    return null;
  }
  const pose = await runtime.readEdgeLocalizationPose(config).catch((error) => {
    log("Failed to read edge pose for base-map CRS inference:", error.message);
    return null;
  });
  if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.y)) {
    return null;
  }
  const posePoint = { x: pose.x, y: pose.y, z: 0 };
  const candidates = ["APOLLO_UTM_ZONE_50", "GAUSS_KRUGER_CM114"]
    .map((sourceCrs) => {
      const projected = projectCoordinateToApollo(rawCenter, sourceCrs);
      return projected
        ? {
            sourceCrs,
            projectedCenter: projected,
            distanceToEdgePoseMeters: coordinateDistanceMeters(projected, posePoint),
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.distanceToEdgePoseMeters - right.distanceToEdgePoseMeters);
  const best = candidates[0];
  const next = candidates[1];
  const maxDistanceMeters = Number(process.env.MAP_BASE_MAP_EDGE_POSE_INFER_METERS || 1000);
  const ratio = next?.distanceToEdgePoseMeters
    ? best.distanceToEdgePoseMeters / Math.max(next.distanceToEdgePoseMeters, 1)
    : 0;
  if (best && best.distanceToEdgePoseMeters <= maxDistanceMeters && (!next || ratio <= 0.2)) {
    return {
      ...best,
      edgePose: posePoint,
      maxDistanceMeters,
      confidence: "edge_pose_nearest_projection",
      candidates,
    };
  }
  return {
    sourceCrs: null,
    edgePose: posePoint,
    maxDistanceMeters,
    confidence: "no_projection_close_to_edge_pose",
    candidates,
  };
}

async function enrichEditorMapCoordinateFromBaseMap(mapName, map) {
  if (!map) {
    return { map, enriched: null };
  }
  const binding = await stampEditorMapBaseMapBinding(mapName, map);
  map = binding.map;
  const strippedUnsafeAnchor = editorMapHasUnsafeBaseMapAnchor(map);
  if (strippedUnsafeAnchor) {
    map = stripUnsafeBaseMapAnchor(map);
  }
  const sourceCrs = getEditorMapCoordinateFrame(map);
  if (
    sourceCrs === "APOLLO_UTM_ZONE_50" ||
    sourceCrs === "WGS84_LON_LAT" ||
    sourceCrs === "GAUSS_KRUGER_CM114" ||
    getEditorMapApolloAnchor(map)
  ) {
    return {
      map,
      enriched: binding.matched
        ? {
            mapName,
            baseMap: binding.matched.baseMapName,
            sourceFile: binding.matched.sourceFile,
            origin: binding.matched.center,
            sourceCrs: sourceCrs || null,
            targetCrs: APOLLO_TARGET_CRS,
            strippedUnsafeAnchor,
          }
        : null,
    };
  }
  const baseMapDir = await resolveBaseMapDirForMap(map);
  const baseMapCoordinate = await readBaseMapCoordinateSource(baseMapDir);
  const explicitBaseSourceCrs = ["APOLLO_UTM_ZONE_50", "WGS84_LON_LAT", "GAUSS_KRUGER_CM114"].includes(
    baseMapCoordinate?.rawSourceCrs,
  )
    ? baseMapCoordinate.rawSourceCrs
    : null;
  const inferredSource = explicitBaseSourceCrs
    ? null
    : await inferBaseMapSourceCrsFromEdgePose(baseMapCoordinate);
  const baseSourceCrs = explicitBaseSourceCrs || inferredSource?.sourceCrs || null;
  if (["APOLLO_UTM_ZONE_50", "WGS84_LON_LAT", "GAUSS_KRUGER_CM114"].includes(baseSourceCrs)) {
    const enrichedMap = JSON.parse(JSON.stringify(map));
    const rawCenter = baseMapCoordinate.rawCenter || baseMapCoordinate.center;
    const targetOrigin = projectCoordinateToApollo(rawCenter, baseSourceCrs);
    enrichedMap.sourceCrs = "LOCAL_ENU_METERS";
    enrichedMap.coordinateFrame = "LOCAL_ENU_METERS";
    enrichedMap.baseMapDir = baseMapCoordinate.baseMapName;
    enrichedMap.basemapCenter = coordinateFromAny(enrichedMap.basemapCenter) || rawCenter;
    enrichedMap.anchor =
      baseSourceCrs === "GAUSS_KRUGER_CM114"
        ? {
            source: "base_map_coordinate_metadata:gauss_kruger_cm114_local_origin",
            sourceCrs: "GAUSS_KRUGER_CM114",
            sourceOrigin: rawCenter,
            targetOrigin,
            baseMap: baseMapCoordinate.baseMapName,
            sourceFile: baseMapCoordinate.sourceFile,
            confidence: inferredSource?.confidence || "base_map_metadata",
          }
        : {
            source: "base_map_coordinate_metadata:apollo_utm_local_origin",
            utm: targetOrigin || rawCenter,
            baseMap: baseMapCoordinate.baseMapName,
            sourceFile: baseMapCoordinate.sourceFile,
            confidence: inferredSource?.confidence || "base_map_metadata",
          };
    enrichedMap.apolloOrigin = baseSourceCrs === "APOLLO_UTM_ZONE_50" ? targetOrigin || rawCenter : undefined;
    enrichedMap.coordinateMetadata = {
      ...(enrichedMap.coordinateMetadata || {}),
      sourceCrs: "LOCAL_ENU_METERS",
      targetCrs: APOLLO_TARGET_CRS,
      anchor: enrichedMap.anchor,
      baseMap: {
        name: baseMapCoordinate.baseMapName,
        sourceFile: baseMapCoordinate.sourceFile,
        center: baseMapCoordinate.center || rawCenter,
        bounds: baseMapCoordinate.bounds,
        coordinate: baseMapCoordinate.coordinate,
        rawPointCloud: baseMapCoordinate.coordinateMetadata?.rawPointCloud || {
          sourceCrs: baseSourceCrs,
          confidence: inferredSource?.confidence || "base_map_metadata",
          center: rawCenter,
          bounds: baseMapCoordinate.bounds,
        },
        sourceInference: inferredSource || null,
      },
    };
    enrichedMap.header = {
      ...(enrichedMap.header || {}),
      projection: { proj: APOLLO_TARGET_CRS.proj4 },
    };
    return {
      map: enrichedMap,
      enriched: {
        mapName,
        baseMap: baseMapCoordinate.baseMapName,
        sourceFile: baseMapCoordinate.sourceFile,
        sourceCrs: "LOCAL_ENU_METERS",
        sourceProjectedCrs: baseSourceCrs,
        sourceOrigin: rawCenter,
        targetOrigin,
        targetCrs: APOLLO_TARGET_CRS,
        inferredFromEdgePose: inferredSource || null,
        strippedUnsafeAnchor,
      },
    };
  }
  const origin = coordinateFromAny(baseMapCoordinate?.editorOrigin);
  if (!coordinateLooksGlobalApollo(origin)) {
    return { map, enriched: null };
  }
  const enrichedMap = JSON.parse(JSON.stringify(map));
  const anchor = {
    source: "base_map_coordinate_metadata:center_as_local_origin",
    utm: origin,
    baseMap: baseMapCoordinate.baseMapName,
    sourceFile: baseMapCoordinate.sourceFile,
    rawPointCloudCrs: baseMapCoordinate.coordinateMetadata?.rawPointCloud?.sourceCrs || null,
    confidence: baseMapCoordinate.coordinateMetadata?.rawPointCloud?.confidence || "base_map_center",
  };
  enrichedMap.sourceCrs = "LOCAL_ENU_METERS";
  enrichedMap.coordinateFrame = "LOCAL_ENU_METERS";
  enrichedMap.baseMapDir = baseMapCoordinate.baseMapName;
  enrichedMap.basemapCenter = coordinateFromAny(enrichedMap.basemapCenter) || baseMapCoordinate.center || origin;
  enrichedMap.apolloOrigin = origin;
  enrichedMap.anchor = anchor;
  enrichedMap.header = {
    ...(enrichedMap.header || {}),
    origin,
    projection: { proj: APOLLO_TARGET_CRS.proj4 },
  };
  enrichedMap.coordinateMetadata = {
    ...(enrichedMap.coordinateMetadata || {}),
    sourceCrs: "LOCAL_ENU_METERS",
    targetCrs: APOLLO_TARGET_CRS,
    anchor,
    baseMap: {
      name: baseMapCoordinate.baseMapName,
      sourceFile: baseMapCoordinate.sourceFile,
      center: baseMapCoordinate.center || origin,
      bounds: baseMapCoordinate.bounds,
      coordinate: baseMapCoordinate.coordinate,
      rawPointCloud: baseMapCoordinate.coordinateMetadata?.rawPointCloud || null,
      editorLocalFrame: baseMapCoordinate.coordinateMetadata?.editorLocalFrame || null,
    },
  };
  return {
    map: enrichedMap,
    enriched: {
      mapName,
      baseMap: baseMapCoordinate.baseMapName,
      sourceFile: baseMapCoordinate.sourceFile,
      origin,
      sourceCrs: "LOCAL_ENU_METERS",
      targetCrs: APOLLO_TARGET_CRS,
    },
  };
}

async function findApolloAnchorForBaseCenter(mapName, baseCenter) {
  if (!baseCenter) {
    return null;
  }
  const candidates = [];
  const pushCandidate = async (candidateName, filePath, kind) => {
    if (!candidateName || candidateName === mapName || !(await pathExists(filePath))) {
      return;
    }
    try {
      const stat = await fsp.stat(filePath);
      const candidate = JSON.parse(await fsp.readFile(filePath, "utf8"));
      const candidateBaseCenter = getEditorMapBaseCenter(candidate);
      const anchor = getEditorMapApolloAnchor(candidate);
      if (!candidateBaseCenter || !anchor) {
        return;
      }
      const baseCenterDistance = coordinateDistanceMeters(candidateBaseCenter, baseCenter);
      if (baseCenterDistance <= 5) {
        candidates.push({
          mapName: candidateName,
          kind,
          filePath,
          anchor,
          baseCenterDistance,
          mtimeMs: stat.mtimeMs,
        });
      }
    } catch (error) {
      log("Failed to inspect coordinate anchor candidate:", filePath, error.message);
    }
  };

  await ensureDir(config.editorMapRoot);
  const editorEntries = await fsp.readdir(config.editorMapRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of editorEntries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await pushCandidate(entry.name.replace(/\.json$/i, ""), path.join(config.editorMapRoot, entry.name), "editor_map");
    }
  }

  const releaseEntries = await fsp.readdir(config.releaseRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of releaseEntries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      await pushCandidate(entry.name, path.join(config.releaseRoot, entry.name, "editor_map.json"), "released_map");
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0] || null;
}

async function inferMissingApolloAnchor(mapName, map) {
  const sourceCrs = String(map?.sourceCrs || map?.source_crs || map?.coordinateFrame || "").toUpperCase();
  const projectedAnchor = map?.anchor || map?.coordinateAnchor || map?.coordinate_anchor || map?.coordinateMetadata?.anchor;
  const projectedAnchorSourceCrs = normalizeCoordinateFrame(
    projectedAnchor?.sourceCrs || projectedAnchor?.source_crs || projectedAnchor?.rawPointCloudCrs,
  );
  if (
    !map ||
    sourceCrs === "APOLLO_UTM_ZONE_50" ||
    sourceCrs === "WGS84_LON_LAT" ||
    sourceCrs === "GAUSS_KRUGER_CM114" ||
    projectedAnchorSourceCrs === "GAUSS_KRUGER_CM114" ||
    getEditorMapApolloAnchor(map)
  ) {
    return { map, inferred: null };
  }
  const baseCenter = getEditorMapBaseCenter(map);
  const match = await findApolloAnchorForBaseCenter(mapName, baseCenter);
  if (!match) {
    return { map, inferred: null };
  }
  const inferredMap = JSON.parse(JSON.stringify(map));
  const origin = match.anchor.coordinate;
  inferredMap.apolloOrigin = origin;
  inferredMap.anchor = {
    source: `inferred_same_basemap:${match.mapName}:${match.anchor.source}`,
    utm: origin,
    referenceMap: match.mapName,
    referenceKind: match.kind,
    baseCenterDistanceMeters: Number(match.baseCenterDistance.toFixed(3)),
  };
  inferredMap.header = {
    ...(inferredMap.header || {}),
    origin,
  };
  return {
    map: inferredMap,
    inferred: {
      sourceMap: match.mapName,
      sourceKind: match.kind,
      sourceAnchor: match.anchor.source,
      baseCenterDistanceMeters: Number(match.baseCenterDistance.toFixed(3)),
      origin,
    },
  };
}

function timestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupEditorMapIfExists(mapName, filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  const historyDir = buildEditorMapHistoryDir(mapName);
  await ensureDir(historyDir);
  const backupPath = path.join(historyDir, `${timestampForFileName()}.json`);
  await fsp.copyFile(filePath, backupPath);
  return backupPath;
}

async function listEditorMapHistory(mapName) {
  const historyDir = buildEditorMapHistoryDir(mapName);
  if (!(await pathExists(historyDir))) {
    return [];
  }
  const entries = await fsp.readdir(historyDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(historyDir, entry.name);
    const stat = await fsp.stat(filePath).catch(() => null);
    items.push({
      file: entry.name,
      path: filePath,
      sizeBytes: stat?.size || 0,
      updatedAt: stat?.mtime?.toISOString?.() || "",
    });
  }
  return items.sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
  );
}

async function saveEditorMap(mapName, data) {
  await ensureDir(config.editorMapRoot);
  const filePath = buildEditorMapPath(mapName);
  const content = JSON.stringify(data, null, 2);
  await backupEditorMapIfExists(mapName, filePath);
  await fsp.writeFile(filePath, content, "utf8");
  return filePath;
}

function editorMapArrayCount(map, ...keys) {
  for (const key of keys) {
    const value = map?.[key];
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 0;
}

function getEditorMapPublishStats(map) {
  return {
    points: editorMapArrayCount(map, "point", "points"),
    lanes: editorMapArrayCount(map, "lane", "lanes"),
    boundaries: editorMapArrayCount(map, "boundary", "boundaries", "laneBoundary", "laneBoundaries"),
  };
}

function assertEditorMapPublishable(mapName, map) {
  const stats = getEditorMapPublishStats(map);
  if (stats.points === 0 && stats.lanes === 0) {
    throw new Error(
      `地图 ${mapName} 是空图，不能发布。请先打开包含车道和标注的地图，再执行发布。`,
    );
  }
  if (stats.points === 0) {
    throw new Error(`地图 ${mapName} 没有点数据，不能生成 Apollo 地图。`);
  }
  if (stats.lanes === 0) {
    throw new Error(`地图 ${mapName} 没有车道，不能作为可部署地图发布。`);
  }
}

function getWebsocketClientInfo(ws) {
  if (!ws.mapeditorClientId) {
    websocketClientSeq += 1;
    ws.mapeditorClientId = `ws-${Date.now().toString(36)}-${websocketClientSeq}`;
  }
  const user = ws.mapeditorUser || {
    username: "anonymous",
    role: "anonymous",
  };
  return {
    clientId: ws.mapeditorClientId,
    username: user.username || "anonymous",
    role: user.role || "",
  };
}

function pruneEditorMapLocks() {
  for (const [mapName, lock] of editorMapLocks.entries()) {
    if (!lock.ws || lock.ws.readyState !== WebSocket.OPEN) {
      editorMapLocks.delete(mapName);
    }
  }
}

function serializeEditorMapLock(lock) {
  if (!lock) {
    return null;
  }
  return {
    mapName: lock.mapName,
    clientId: lock.clientId,
    username: lock.username,
    role: lock.role,
    acquiredAt: lock.acquiredAt,
    updatedAt: lock.updatedAt,
  };
}

function acquireEditorMapLock(mapName, ws) {
  pruneEditorMapLocks();
  const normalizedMapName = normalizeEditorMapName(mapName);
  const client = getWebsocketClientInfo(ws);
  const existing = editorMapLocks.get(normalizedMapName);
  if (existing && existing.clientId !== client.clientId) {
    return {
      granted: false,
      lock: serializeEditorMapLock(existing),
    };
  }
  const lock = {
    ...client,
    mapName: normalizedMapName,
    ws,
    acquiredAt: existing?.acquiredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  editorMapLocks.set(normalizedMapName, lock);
  return {
    granted: true,
    lock: serializeEditorMapLock(lock),
  };
}

function ensureEditorMapLockForWrite(mapName, ws) {
  const lock = acquireEditorMapLock(mapName, ws);
  if (!lock.granted) {
    throw new Error(
      `地图 ${mapName} 正在被 ${lock.lock?.username || "其他用户"} 编辑，请稍后再保存或发布`,
    );
  }
  return lock.lock;
}

function releaseEditorMapLocksForSocket(ws) {
  for (const [mapName, lock] of editorMapLocks.entries()) {
    if (lock.ws === ws) {
      editorMapLocks.delete(mapName);
    }
  }
}

async function prepareReleaseDir(mapName, allowOverwrite) {
  const releaseDir = path.join(config.releaseRoot, mapName);
  if (await pathExists(releaseDir)) {
    if (!allowOverwrite) {
      return { exists: true, dir: releaseDir };
    }
    const backupDir = `${releaseDir}.bak-release-${Date.now()}`;
    await fsp.rename(releaseDir, backupDir);
    await ensureDir(releaseDir);
    return { exists: false, dir: releaseDir, backupDir };
  }
  await ensureDir(releaseDir);
  return { exists: false, dir: releaseDir };
}

async function restoreReleaseDirOnFailure(preparedReleaseDir) {
  if (!preparedReleaseDir?.backupDir) {
    return;
  }
  if (!(await pathExists(preparedReleaseDir.backupDir))) {
    return;
  }
  await fsp.rm(preparedReleaseDir.dir, { recursive: true, force: true }).catch(() => {});
  await fsp.rename(preparedReleaseDir.backupDir, preparedReleaseDir.dir).catch(() => {});
}

function sendWsResponse(ws, requestId, info) {
  const payload = {
    action: "response",
    data: {
      requestId,
      info,
    },
  };
  ws.send(JSON.stringify(payload));
}

async function handleGetBaseMapDir(ws, requestId) {
  const mapList = await listBaseMaps();
  sendWsResponse(ws, requestId, {
    code: 0,
    message: "Success",
    data: { map_list: mapList },
  });
}

async function handleGetMapFileList(ws, requestId) {
  const mapList = await listEditorMaps();
  sendWsResponse(ws, requestId, {
    code: 0,
    message: "Success",
    data: { map_list: mapList },
  });
}

async function handleOpenMapFile(ws, requestId, info) {
  info = info || {};
  try {
    const { mapName } = info;
    if (!mapName) {
      throw new Error("Missing mapName");
    }
    const lock = acquireEditorMapLock(mapName, ws);
    const map = await loadEditorMap(mapName);
    sendWsResponse(ws, requestId, {
      code: 0,
      message: "Success",
      data: { map, lock: lock.lock, lockGranted: lock.granted },
    });
  } catch (error) {
    log("OpenMapFile failed:", error);
    sendWsResponse(ws, requestId, {
      code: 15010,
      message: `加载标注地图失败: ${error.message}`,
    });
  }
}

async function handleSaveMapFile(ws, requestId, info) {
  info = info || {};
  const { mapName, map, ifCheckFileDuplicated } = info || {};
  if (!mapName || !map) {
    sendWsResponse(ws, requestId, {
      code: 15011,
      message: "保存地图缺少必要参数",
    });
    return;
  }
  try {
    const lock = ensureEditorMapLockForWrite(mapName, ws);
    const filePath = buildEditorMapPath(mapName);
    const exists = await pathExists(filePath);
    if (exists && ifCheckFileDuplicated) {
      sendWsResponse(ws, requestId, {
        code: 15007,
        message: "文件已存在，需确认覆盖",
      });
      return;
    }
    const coordinateEnrichment = await enrichEditorMapCoordinateFromBaseMap(mapName, map);
    if (coordinateEnrichment.enriched) {
      log(
        `Stamped base-map coordinate anchor for ${mapName} from ${coordinateEnrichment.enriched.baseMap}`,
        coordinateEnrichment.enriched,
      );
    }
    await saveEditorMap(mapName, coordinateEnrichment.map);
    sendWsResponse(ws, requestId, {
      code: 0,
      message: "Success",
      data: { mapName, coordinateMetadataEnrichment: coordinateEnrichment.enriched, lock },
    });
  } catch (error) {
    log("SaveMapFile failed:", error);
    sendWsResponse(ws, requestId, {
      code: 15012,
      message: `保存地图失败: ${error.message}`,
    });
  }
}

async function runConverter(mapName, jsonPath, releaseDir) {
  let baseMapDir = null;
  try {
    const map = JSON.parse((await fsp.readFile(jsonPath, "utf8")).replace(/^\uFEFF/, ""));
    baseMapDir = await resolveBaseMapDirForMap(map);
  } catch (error) {
    log(`Failed to resolve base map for release ${mapName}:`, error.message);
  }
  if (!baseMapDir && lastAccessedBaseMapDir && (await pathExists(lastAccessedBaseMapDir))) {
    baseMapDir = lastAccessedBaseMapDir;
  }
  log(`Launching converter for ${mapName} with ${config.runtimeMode} runtime`);
  return runtime.convertEditorMap(config, {
    mapName,
    jsonPath,
    releaseDir,
    baseMapDir,
  });
}

async function handleReleaseMapFile(ws, requestId, info) {
  info = info || {};
  const { mapName, map, ifCheckFileDuplicated } = info || {};
  if (!mapName || !map) {
    sendWsResponse(ws, requestId, {
      code: 15013,
      message: "发布地图缺少必要参数",
    });
    return;
  }
  let preparedReleaseDir = null;
  try {
    const lock = ensureEditorMapLockForWrite(mapName, ws);
    assertEditorMapPublishable(mapName, map);
    const coordinateEnrichment = await enrichEditorMapCoordinateFromBaseMap(mapName, map);
    if (coordinateEnrichment.enriched) {
      log(
        `Stamped base-map coordinate anchor for release ${mapName} from ${coordinateEnrichment.enriched.baseMap}`,
        coordinateEnrichment.enriched,
      );
    }
    const anchorInference = await inferMissingApolloAnchor(mapName, coordinateEnrichment.map);
    if (anchorInference.inferred) {
      log(
        `Inferred Apollo coordinate anchor for ${mapName} from ${anchorInference.inferred.sourceMap}`,
        anchorInference.inferred,
      );
    }
    await ensureDir(config.releaseRoot);
    preparedReleaseDir = await prepareReleaseDir(
      mapName,
      !ifCheckFileDuplicated,
    );
    const { exists, dir } = preparedReleaseDir;
    if (exists && ifCheckFileDuplicated) {
      sendWsResponse(ws, requestId, {
        code: 15017,
        message: "发布目录已存在，需确认覆盖",
      });
      return;
    }
    const jsonPath = await saveEditorMap(mapName, anchorInference.map);
    const result = await runConverter(mapName, jsonPath, dir);
    const releasedMaps = await runtime.listReleasedMaps(config);
    const releaseSummary = releasedMaps.find((item) => item.mapName === mapName);
    if (!releaseSummary?.ready) {
      throw new Error(
        `发布包未通过可部署检查: ${releaseSummary?.statusMessage || "未知错误"}`,
      );
    }
    let apolloLiteStage = null;
    let apolloLiteStageError = null;
    if (config.apolloLite?.enabled && config.apolloLite?.autoStageOnRelease) {
      try {
        apolloLiteStage = await runtime.stageReleasedMapToApolloLite(config, {
          mapName,
          progress: (message) => log(`[apollolite:${mapName}] ${message}`),
        });
      } catch (stageError) {
        apolloLiteStageError = stageError.message;
        log("ApolloLite staging after release failed:", stageError);
      }
    }
    sendWsResponse(ws, requestId, {
      code: 0,
      message: "Success",
      data: {
        mapName,
        output_dir: dir,
        stdout: result.stdout.trim(),
        coordinateMetadataEnrichment: coordinateEnrichment.enriched,
        coordinateAnchorInference: anchorInference.inferred,
        apolloLiteStage,
        apolloLiteStageError,
        lock,
      },
    });
  } catch (error) {
    await restoreReleaseDirOnFailure(preparedReleaseDir);
    log("ReleaseMapFile failed:", error);
    sendWsResponse(ws, requestId, {
      code: 15018,
      message: `发布地图失败: ${error.message}`,
    });
  }
}

function handleGetAccountMapToolInfo(ws, requestId) {
  sendWsResponse(ws, requestId, {
    code: 0,
    message: "Success",
    data: {
      mapEditorPrerogative: {
        status: 0,
        expireTime: null,
      },
    },
  });
}

wss.on("connection", (ws, req) => {
  const user = getAuthUserFromRequest(req);
  if (config.auth?.enabled && !user) {
    ws.close(1008, "Authentication required");
    return;
  }
  ws.mapeditorUser = user || {
    username: "admin",
    role: "admin",
    authEnabled: false,
  };
  getWebsocketClientInfo(ws);
  ws.on("close", () => {
    releaseEditorMapLocksForSocket(ws);
  });
  ws.on("message", async (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      log("Received invalid JSON message:", raw);
      return;
    }
    const { type, data: payload } = message;
    const requestId = payload && payload.requestId;
    if (!requestId) {
      log("Missing requestId in message:", message);
      return;
    }
    try {
      switch (type) {
        case "GetBaseMapDir":
          await handleGetBaseMapDir(ws, requestId);
          break;
        case "GetMapFileList":
          await handleGetMapFileList(ws, requestId);
          break;
        case "OpenMapFile":
          await handleOpenMapFile(
            ws,
            requestId,
            payload ? payload.info : undefined,
          );
          break;
        case "SaveMapFile":
          await handleSaveMapFile(
            ws,
            requestId,
            payload ? payload.info : undefined,
          );
          break;
        case "ReleaseMapFile":
          await handleReleaseMapFile(
            ws,
            requestId,
            payload ? payload.info : undefined,
          );
          break;
        case "GetAccountMapToolInfo":
          handleGetAccountMapToolInfo(ws, requestId);
          break;
        default:
          log("Unhandled message type:", type);
          sendWsResponse(ws, requestId, {
            code: 404,
            message: `Unknown request type: ${type}`,
          });
          break;
      }
    } catch (error) {
      log("Error handling websocket message:", error);
      sendWsResponse(ws, requestId, {
        code: 15099,
        message: `服务端异常: ${error.message}`,
      });
    }
  });
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/runtime/auth/session", (req, res) => {
  res.json({
    code: 0,
    message: "Success",
    data: buildAuthSessionPayload(req),
  });
});

app.post("/runtime/auth/login", (req, res) => {
  if (!config.auth?.enabled) {
    res.json({
      code: 0,
      message: "Success",
      data: buildAuthSessionPayload(req),
    });
    return;
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const expectedUsername = String(config.auth.username || "admin");
  const expectedPassword = String(config.auth.password || "");
  const usernameMatches = username === expectedUsername;
  const passwordMatches =
    expectedPassword.length > 0 && safeCompareText(password, expectedPassword);
  if (!usernameMatches || !passwordMatches) {
    res.status(401).json({
      code: 401,
      message: "用户名或密码错误",
    });
    return;
  }
  const sessionId = crypto.randomBytes(32).toString("hex");
  const ttlHours = Math.max(1, Number(config.auth.sessionTtlHours) || 12);
  const expiresAt = Date.now() + ttlHours * 60 * 60 * 1000;
  authSessions.set(sessionId, {
    username,
    role: config.auth.role || "admin",
    expiresAt,
  });
  setAuthCookie(res, sessionId, expiresAt);
  res.json({
    code: 0,
    message: "Success",
    data: buildAuthSessionPayload({
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionId}`,
      },
    }),
  });
});

app.post("/runtime/auth/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[AUTH_COOKIE_NAME]) {
    authSessions.delete(cookies[AUTH_COOKIE_NAME]);
  }
  res.clearCookie(AUTH_COOKIE_NAME);
  res.json({
    code: 0,
    message: "Success",
  });
});

app.use(requireAuth);

app.get("/config", (_req, res) => {
  res.json(buildPublicConfigPayload());
});

app.get("/runtime/status", requirePermission("canView"), async (_req, res) => {
  try {
    sendSuccess(res, await runtime.getStatus(config));
  } catch (error) {
    sendError(res, 500, 500, error.message);
  }
});

app.get("/runtime/doctor", requirePermission("canView"), async (_req, res) => {
  try {
    sendSuccess(res, await runtime.getRuntimeDoctor(config));
  } catch (error) {
    sendError(res, 500, 500, error.message);
  }
});

app.get("/runtime/released-maps", requirePermission("canView"), async (_req, res) => {
  try {
    sendSuccess(res, {
      maps: await runtime.listReleasedMaps(config),
    });
  } catch (error) {
    sendError(res, 500, 500, error.message);
  }
});

app.get("/runtime/ai-assistant/status", requirePermission("canView"), (_req, res) => {
  sendSuccess(res, {
    provider: process.env.OPENAI_API_KEY ? "openai" : "local",
    model: process.env.MAP_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini",
    configured: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post("/runtime/ai-assistant", requirePermission("canEdit"), async (req, res) => {
  const question = aiAssistant.clipText(req.body?.question, 2000).trim();
  const context = aiAssistant.normalizeAssistantContext(req.body?.context || {});
  if (!question) {
    sendError(res, 400, 15400, "请输入要咨询的问题");
    return;
  }
  if (!question) {
    sendError(res, 400, 15400, "请输入要咨询的问题");
    return;
  }

  const localReply = aiAssistant.buildLocalMapAssistantReply(question, context);
  if (!process.env.OPENAI_API_KEY) {
    sendSuccess(res, {
      provider: "local",
      configured: false,
      answer: localReply,
      actions: [],
    });
    return;
  }

  try {
    const model =
      process.env.MAP_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
    const assistantPrompt = aiAssistant.buildOpenAIPrompt(
      question,
      context,
      localReply,
    );
    const payload = await postOpenAIResponse({
      model,
      input: [
        {
          role: "system",
          content: assistantPrompt.instructions.join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(assistantPrompt, null, 2),
        },
      ],
    });
    const answer = parseOpenAIResponseText(payload) || localReply;
    sendSuccess(res, {
      provider: "openai",
      configured: true,
      model,
      answer,
      actions: [],
    });
  } catch (error) {
    log("AI assistant OpenAI fallback:", error.message);
    sendSuccess(res, {
      provider: "local",
      configured: true,
      degraded: true,
      error: error.message,
      answer: `${localReply}\n\n外部 AI 暂时不可用，已使用本地诊断兜底：${error.message}`,
      actions: [],
    });
  }
  return;

  try {
    const model =
      process.env.MAP_AI_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
    const payload = await postOpenAIResponse({
      model,
      input: [
        {
          role: "system",
          content:
            "你是地图编辑器内置的工程诊断助手。只根据用户提供的地图上下文回答，重点关注车道连接、弯道半径、宽度、拓扑、发布风险。给出可执行步骤，不要编造不存在的工具，不要直接承诺已经修改地图。",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              question,
              context,
              localBaseline: localReply,
            },
            null,
            2,
          ),
        },
      ],
    });
    const answer = parseOpenAIResponseText(payload) || localReply;
    sendSuccess(res, {
      provider: "openai",
      configured: true,
      model,
      answer,
      actions: [],
    });
  } catch (error) {
    log("AI assistant OpenAI fallback:", error.message);
    sendSuccess(res, {
      provider: "local",
      configured: true,
      degraded: true,
      error: error.message,
      answer: `${localReply}\n\n外部 AI 暂时不可用，已使用本地诊断兜底：${error.message}`,
      actions: [],
    });
  }
});

app.post(
  "/runtime/import-base-map",
  requirePermission("canEdit"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        throw new Error("file is required");
      }
      await validateUploadedFiles([req.file]);
      const result = await runtime.importBaseMapZip(config, {
        zipPath: req.file.path,
        mapName: req.body.mapName,
        overwrite: req.body.overwrite === "true",
      });
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      log("Import base map failed:", error);
      res.status(500).json({
        code: 15050,
        message: error.message,
      });
    } finally {
      if (req.file && req.file.path) {
        fsp.unlink(req.file.path).catch(() => {});
      }
    }
  },
);

app.post(
  "/runtime/import-point-cloud-base-map",
  requirePermission("canEdit"),
  upload.any(),
  async (req, res) => {
    try {
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      if (uploadedFiles.length === 0) {
        throw new Error("file is required");
      }
      await validateUploadedFiles(uploadedFiles);
      const result =
        uploadedFiles.length === 1
          ? await runtime.importPointCloudBaseMap(config, {
              cloudPath: uploadedFiles[0].path,
              originalName: uploadedFiles[0].originalname,
              mapName: req.body.mapName,
              overwrite: req.body.overwrite === "true",
            })
          : await runtime.importPointCloudFilesBaseMap(config, {
              files: uploadedFiles.map((file) => ({
                path: file.path,
                originalName: file.originalname,
              })),
              mapName: req.body.mapName,
              overwrite: req.body.overwrite === "true",
            });
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      log("Import point cloud base map failed:", error);
      res.status(500).json({
        code: 15052,
        message: error.message,
      });
    } finally {
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      for (const file of uploadedFiles) {
        if (file && file.path) {
          fsp.unlink(file.path).catch(() => {});
        }
      }
    }
  },
);

app.post("/runtime/analyze-data-package", requirePermission("canEdit"), upload.any(), async (req, res) => {
  try {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    if (uploadedFiles.length === 0) {
      throw new Error("file is required");
    }
    await validateUploadedFiles(uploadedFiles);
    const result = await runtime.analyzeDataPackage(config, {
      files: uploadedFiles.map((file) => ({
        path: file.path,
        originalName: file.originalname,
      })),
      packageName: req.body.packageName,
    });
    res.json({
      code: 0,
      message: "Success",
      data: result,
    });
  } catch (error) {
    log("Analyze data package failed:", error);
    res.status(500).json({
      code: 15053,
      message: error.message,
    });
  } finally {
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    for (const file of uploadedFiles) {
      if (file && file.path) {
        fsp.unlink(file.path).catch(() => {});
      }
    }
  }
});

app.post("/runtime/data-package-upload-sessions", requirePermission("canEdit"), async (req, res) => {
  try {
    const body = req.body || {};
    const files = normalizeChunkUploadFiles(body.files);
    const session = {
      id: buildUploadSessionId(),
      packageName: String(body.packageName || "").trim(),
      chunkSize: DATA_PACKAGE_CHUNK_SIZE_BYTES,
      status: "uploading",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files,
    };
    await writeChunkUploadSession(session);
    sendSuccess(res, {
      session,
    });
  } catch (error) {
    log("Create data package upload session failed:", error);
    sendError(res, 500, 15083, error.message);
  }
});

app.put(
  "/runtime/data-package-upload-sessions/:sessionId/files/:fileIndex/chunks/:chunkIndex",
  requirePermission("canEdit"),
  upload.single("chunk"),
  async (req, res) => {
    let uploadedPath = req.file?.path || "";
    try {
      if (!uploadedPath) {
        throw new Error("chunk is required");
      }
      const session = await readChunkUploadSession(req.params.sessionId);
      if (session.status !== "uploading") {
        throw new Error("上传会话已结束");
      }
      const { fileIndex, chunkIndex, file } = assertChunkUploadIndex(
        session,
        req.params.fileIndex,
        req.params.chunkIndex,
      );
      const stat = await fsp.stat(uploadedPath);
      const expectedSize = Math.min(
        session.chunkSize,
        file.size - chunkIndex * session.chunkSize,
      );
      if (stat.size !== expectedSize) {
        throw new Error(
          `${file.name} 分片 ${chunkIndex + 1}/${file.chunkCount} 大小不一致：应为 ${formatBytes(
            expectedSize,
          )}，实际 ${formatBytes(stat.size)}`,
        );
      }
      const targetPath = getChunkUploadPartPath(session.id, fileIndex, chunkIndex);
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.rm(targetPath, { force: true }).catch(() => {});
      await fsp.rename(uploadedPath, targetPath);
      uploadedPath = "";
      const uploadedChunks = new Set(file.uploadedChunks || []);
      uploadedChunks.add(chunkIndex);
      file.uploadedChunks = Array.from(uploadedChunks).sort((left, right) => left - right);
      await writeChunkUploadSession(session);
      sendSuccess(res, {
        sessionId: session.id,
        fileIndex,
        chunkIndex,
        uploadedChunks: file.uploadedChunks.length,
        chunkCount: file.chunkCount,
      });
    } catch (error) {
      log("Upload data package chunk failed:", error);
      sendError(res, 500, 15084, error.message);
    } finally {
      if (uploadedPath) {
        await fsp.unlink(uploadedPath).catch(() => {});
      }
    }
  },
);

app.post(
  "/runtime/data-package-upload-sessions/:sessionId/complete",
  requirePermission("canEdit"),
  async (req, res) => {
    let staged = null;
    try {
      const session = await readChunkUploadSession(req.params.sessionId);
      if (session.status === "completed") {
        throw new Error("上传会话已经完成");
      }
      staged = await assembleChunkUploadSession(session);
      session.status = "completed";
      session.completedAt = new Date().toISOString();
      await writeChunkUploadSession(session);
      const request = {
        packageName: session.packageName || "",
        fileCount: session.files.length,
        uploadedFiles: session.files.map((file) => file.name),
        uploadSessionId: session.id,
        uploadMode: "chunked",
      };
      const job = startRuntimeJob(
        "analyze-data-package",
        async (runtimeJob) => {
          try {
            await appendRuntimeJobLog(
              runtimeJob,
              `Analyzing chunked upload session ${session.id}`,
            );
            return await runtime.analyzeDataPackage(config, {
              files: staged.files,
              packageName: session.packageName,
            });
          } finally {
            await Promise.all([
              fsp.rm(staged.jobTmpDir, { recursive: true, force: true }).catch(() => {}),
              fsp.rm(getChunkUploadSessionDir(session.id), {
                recursive: true,
                force: true,
              }).catch(() => {}),
            ]);
          }
        },
        request,
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      log("Complete data package upload session failed:", error);
      if (staged?.jobTmpDir) {
        await fsp.rm(staged.jobTmpDir, { recursive: true, force: true }).catch(() => {});
      }
      sendError(res, 500, 15085, error.message);
    }
  },
);

app.post(
  "/runtime/analyze-data-package-job",
  requirePermission("canEdit"),
  upload.any(),
  async (req, res) => {
    let staged = null;
    try {
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      if (uploadedFiles.length === 0) {
        throw new Error("file is required");
      }
      await validateUploadedFiles(uploadedFiles);
      const stagingId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      staged = await moveUploadedFilesToJobDir(stagingId, uploadedFiles);
      const request = {
        packageName: req.body.packageName || "",
        fileCount: uploadedFiles.length,
        uploadedFiles: uploadedFiles.map((file) => file.originalname),
      };
      const job = startRuntimeJob(
        "analyze-data-package",
        async (runtimeJob) => {
          try {
            await appendRuntimeJobLog(
              runtimeJob,
              `Analyzing ${staged.files.length} uploaded file(s)`,
            );
            return await runtime.analyzeDataPackage(config, {
              files: staged.files,
              packageName: req.body.packageName,
            });
          } finally {
            await fsp
              .rm(staged.jobTmpDir, { recursive: true, force: true })
              .catch(() => {});
          }
        },
        request,
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      log("Start analyze data package job failed:", error);
      if (staged?.jobTmpDir) {
        await fsp
          .rm(staged.jobTmpDir, { recursive: true, force: true })
          .catch(() => {});
      }
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      for (const file of uploadedFiles) {
        if (file && file.path) {
          await fsp.unlink(file.path).catch(() => {});
        }
      }
      sendError(res, 500, 15057, error.message);
    }
  },
);

app.get("/runtime/data-packages", requirePermission("canView"), async (req, res) => {
  try {
    const detail = String(req.query.detail || "").toLowerCase();
    res.json({
      code: 0,
      message: "Success",
      data: {
        packages: await runtime.listDataPackages(config, {
          includeAnalyses: detail !== "summary",
        }),
      },
    });
  } catch (error) {
    log("List data packages failed:", error);
    res.status(500).json({
      code: 15054,
      message: error.message,
    });
  }
});

app.get("/runtime/capture-source-packages", requirePermission("canView"), async (_req, res) => {
  sendSuccess(res, {
    disabled: true,
    packages: [],
    message: "生产模式已关闭自动同步。请在采图包工作台手动上传最新 LAS/LAZ/ZIP 包。",
  });
});

app.post("/runtime/sync-capture-source-package-job", requirePermission("canEdit"), async (req, res) => {
  try {
    if (!config.captureAutoSync?.enabled) {
      sendError(
        res,
        410,
        15068,
        "生产模式已关闭采图目录同步。请手动上传最新 LAS/LAZ/ZIP 包，避免旧采集与新采集叠加。",
      );
      return;
    }
    const body = req.body || {};
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const job = startRuntimeJob(
      "sync-capture-source-package",
      (runtimeJob) =>
        runtime.importCaptureSourcePackage(config, {
          ...body,
          progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
        }),
      {
        sourcePackage: body.sourcePackage || "",
        overwrite: body.overwrite === true,
      },
    );
    sendAcceptedJob(res, job);
  } catch (error) {
    sendError(res, 500, 15068, error.message);
  }
});

app.post("/runtime/sync-capture-source-packages-job", requirePermission("canEdit"), async (req, res) => {
  try {
    if (!config.captureAutoSync?.enabled) {
      sendError(
        res,
        410,
        15069,
        "生产模式已关闭批量自动同步。请在采图包工作台人工确认并上传最新采图包。",
      );
      return;
    }
    const body = req.body || {};
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const job = startRuntimeJob(
      "sync-capture-source-packages",
      (runtimeJob) =>
        runtime.syncCaptureSourcePackages(config, {
          ...body,
          progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
        }),
      {
        onlyNew: body.onlyNew !== false,
        overwrite: body.overwrite === true,
        limit: Number(body.limit) || 50,
      },
    );
    sendAcceptedJob(res, job);
  } catch (error) {
    sendError(res, 500, 15069, error.message);
  }
});

app.post("/runtime/prebuild-data-package-base-maps-job", requirePermission("canEdit"), async (req, res) => {
  try {
    if (!config.inboxAutoPrebuild?.enabled) {
      sendError(
        res,
        410,
        15081,
        "生产模式已关闭后台自动预构建。请选中采图包后手动生成点云资产。",
      );
      return;
    }
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const body = req.body || {};
    const request = {
      ...buildInboxAutoPrebuildRequest("manual"),
      ...body,
      trigger: body.trigger || "manual",
    };
    const job = startRuntimeJob(
      "prebuild-data-package-base-maps",
      (runtimeJob) =>
        runtime.prebuildDataPackageBaseMaps(config, {
          ...request,
          progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
        }),
      request,
    );
    sendSuccess(res, { job: serializeRuntimeJob(job) });
  } catch (error) {
    sendError(res, 500, 15081, error.message);
  }
});

app.patch("/runtime/data-packages/:packageId", requirePermission("canEdit"), async (req, res) => {
  try {
    const result = await runtime.updateDataPackage(config, {
      ...(req.body || {}),
      packageId: req.params.packageId,
    });
    res.json({
      code: 0,
      message: "Success",
      data: result,
    });
  } catch (error) {
    log("Update data package failed:", error);
    res.status(500).json({
      code: 15060,
      message: error.message,
    });
  }
});

app.delete("/runtime/data-packages/:packageId", requirePermission("canEdit"), async (req, res) => {
  try {
    const result = await runtime.deleteDataPackage(config, {
      packageId: req.params.packageId,
    });
    res.json({
      code: 0,
      message: "Success",
      data: result,
    });
  } catch (error) {
    log("Delete data package failed:", error);
    res.status(500).json({
      code: 15061,
      message: error.message,
    });
  }
});

app.post("/runtime/refresh-data-package-analysis-job", requirePermission("canEdit"), async (req, res) => {
  try {
    const body = req.body || {};
    const job = startRuntimeJob(
      "refresh-data-package-analysis",
      () => runtime.refreshDataPackageAnalysis(config, body),
      {
        packageId: body.packageId || "",
      },
    );
    sendAcceptedJob(res, job);
  } catch (error) {
    log("Start refresh data package analysis job failed:", error);
    sendError(res, 500, 15058, error.message);
  }
});

app.post("/runtime/refresh-all-data-package-analysis-job", requirePermission("canEdit"), async (req, res) => {
  try {
    const body = req.body || {};
    const onlyMissing = body.onlyMissing !== false;
    const job = startRuntimeJob(
      "refresh-all-data-package-analysis",
      async (runtimeJob) => {
        const packages = await runtime.listDataPackages(config);
        const targets = onlyMissing
          ? packages.filter(
              (item) => item.workflowStatus?.code === "pending_precheck",
            )
          : packages;
        const results = [];
        await appendRuntimeJobLog(
          runtimeJob,
          `Refreshing ${targets.length} package(s)`,
        );
        for (const item of targets) {
          await appendRuntimeJobLog(
            runtimeJob,
            `Prechecking ${item.packageId}`,
          );
          const result = await runtime.refreshDataPackageAnalysis(config, {
            packageId: item.packageId,
          });
          results.push({
            packageId: item.packageId,
            summary: result.summary,
          });
        }
        return {
          refreshedCount: results.length,
          skippedCount: packages.length - targets.length,
          results,
        };
      },
      {
        onlyMissing,
      },
    );
    sendAcceptedJob(res, job);
  } catch (error) {
    log("Start refresh all data packages analysis job failed:", error);
    sendError(res, 500, 15062, error.message);
  }
});

app.post("/runtime/data-package-stitch-plan", requirePermission("canView"), async (req, res) => {
  try {
    const body = req.body || {};
    const packageIds = Array.isArray(body.packageIds) ? body.packageIds : [];
    const result = await runtime.buildDataPackageStitchPlan(config, packageIds);
    res.status(result.ready ? 200 : 409).json({
      code: result.ready ? 0 : 15063,
      message: result.ready
        ? "Success"
        : "Selected packages cannot be merged safely",
      data: result,
    });
  } catch (error) {
    log("Build data package stitch plan failed:", error);
    res.status(500).json({
      code: 15063,
      message: error.message,
    });
  }
});

app.post("/runtime/import-data-package-base-map", requirePermission("canEdit"), async (req, res) => {
  try {
    const result = await runtime.importDataPackageBaseMap(
      config,
      req.body || {},
    );
    res.json({
      code: 0,
      message: "Success",
      data: result,
    });
  } catch (error) {
    log("Import data package base map failed:", error);
    res.status(500).json({
      code: 15055,
      message: error.message,
    });
  }
});

app.post("/runtime/import-data-package-base-map-job", requirePermission("canEdit"), async (req, res) => {
  try {
    const body = req.body || {};
    const activeJob = findActiveHeavyRuntimeJob();
    if (activeJob) {
      sendRuntimeJobBusy(res, activeJob);
      return;
    }
    const job = startRuntimeJob(
      "import-data-package-base-map",
      (runtimeJob) =>
        runtime.importDataPackageBaseMap(config, {
          ...body,
          progress: (message) => updateRuntimeJobProgress(runtimeJob, message),
        }),
      {
        packageId: body.packageId || "",
        mapName: body.mapName || "",
        overwrite: body.overwrite === true,
      },
    );
    sendAcceptedJob(res, job);
  } catch (error) {
    log("Start data package import job failed:", error);
    sendError(res, 500, 15056, error.message);
  }
});

app.post(
  "/runtime/import-data-packages-merged-base-map-job",
  requirePermission("canEdit"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const packageIds = Array.isArray(body.packageIds) ? body.packageIds : [];
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "import-data-packages-merged-base-map",
        (runtimeJob) =>
          runtime.importMergedDataPackagesBaseMap(config, {
            ...body,
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {
          packageIds,
          mapName: body.mapName || "",
          overwrite: body.overwrite === true,
        },
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      log("Start merged data package import job failed:", error);
      sendError(res, 500, 15059, error.message);
    }
  },
);

app.get("/runtime/assist-drawing-candidates/:mapName", requirePermission("canView"), async (req, res) => {
  try {
    const result = await runtime.generateAssistDrawingCandidates(config, {
      mapName: req.params.mapName,
      layer: req.query.layer,
      level: req.query.level,
      maxTiles: req.query.maxTiles,
      cellPixels: req.query.cellPixels,
      alphaThreshold: req.query.alphaThreshold,
      strongAlphaThreshold: req.query.strongAlphaThreshold,
      minDensity: req.query.minDensity,
    });
    res.json({
      code: 0,
      message: "Success",
      data: result,
    });
  } catch (error) {
    log("Generate assist drawing candidates failed:", error);
    res.status(500).json({
      code: 15067,
      message: error.message,
    });
  }
});

app.get("/runtime/jobs", requirePermission("canView"), (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  sendSuccess(res, {
    jobs: listRuntimeJobs().slice(0, limit),
  });
});

app.get("/runtime/jobs/:jobId", requirePermission("canView"), (req, res) => {
  const job = runtimeJobs.get(req.params.jobId);
  if (!job) {
    sendRuntimeJobNotFound(res, req.params.jobId);
    return;
  }
  sendSuccess(res, {
    job: serializeRuntimeJob(job, {
      includeLogs: req.query.logs === "true",
      tail: req.query.tail,
    }),
  });
});

app.get("/runtime/jobs/:jobId/logs", requirePermission("canView"), (req, res) => {
  if (!runtimeJobs.has(req.params.jobId)) {
    sendRuntimeJobNotFound(res, req.params.jobId);
    return;
  }
  sendSuccess(res, {
    logs: readRuntimeJobLogs(req.params.jobId, req.query.tail),
  });
});

app.get(
  "/runtime/editor-map-locks",
  requirePermission("canView"),
  (_req, res) => {
    pruneEditorMapLocks();
    sendSuccess(res, {
      locks: Array.from(editorMapLocks.values()).map((lock) =>
        serializeEditorMapLock(lock),
      ),
    });
  },
);

app.get(
  "/runtime/editor-map-history/:mapName",
  requirePermission("canView"),
  async (req, res) => {
    try {
      sendSuccess(res, {
        mapName: normalizeEditorMapName(req.params.mapName),
        history: await listEditorMapHistory(req.params.mapName),
      });
    } catch (error) {
      sendError(res, 500, 15060, error.message);
    }
  },
);

app.post(
  "/runtime/import-map-package",
  requirePermission("canDeploy"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        throw new Error("file is required");
      }
      await validateUploadedFiles([req.file]);
      const result = await runtime.importMapPackageZip(config, {
        zipPath: req.file.path,
        mapName: req.body.mapName,
        overwrite: req.body.overwrite === "true",
      });
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      log("Import map package failed:", error);
      res.status(500).json({
        code: 15051,
        message: error.message,
      });
    } finally {
      if (req.file && req.file.path) {
        fsp.unlink(req.file.path).catch(() => {});
      }
    }
  },
);

app.get("/runtime/deploy-config", requirePermission("canDeploy"), (_req, res) => {
  res.json({
    code: 0,
    message: "Success",
    data: runtime.getDeployConfig(config),
  });
});

app.post(
  "/runtime/discover-edge-map-root",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const result = await runtime.discoverEdgeMapRoot(config, req.body || {});
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        code: 15064,
        message: error.message,
      });
    }
  },
);

app.post(
  "/runtime/configure-edge-deploy",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const result = await runtime.configureEdgeDeploy(config, req.body || {});
      const preflight = await runtime.preflightEdgeDeploy(config, req.body || {});
      const preflightErrors = summarizePreflightErrors(preflight);
      res.status(200).json({
        code: preflight.ready ? 0 : 15065,
        message: preflight.ready
          ? "Success"
          : `Edge deploy config saved, but preflight failed${preflightErrors ? `: ${preflightErrors}` : ""}`,
        data: {
          ...result,
          preflight,
        },
      });
    } catch (error) {
      res.status(500).json({
        code: 15065,
        message: error.message,
      });
    }
  },
);

app.get("/runtime/deployments", requirePermission("canDeploy"), async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: "Success",
      data: {
        deployments: await runtime.listDeployments(config),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15046,
      message: error.message,
    });
  }
});

app.get("/runtime/apollolite/status", requirePermission("canView"), async (_req, res) => {
  try {
    res.json({
      code: 0,
      message: "Success",
      data: await runtime.getApolloLiteStatus(config),
    });
  } catch (error) {
    res.status(500).json({
      code: 15052,
      message: error.message,
    });
  }
});

app.get("/runtime/apollolite/diagnose", requirePermission("canView"), async (_req, res) => {
  try {
    const result = await runtime.diagnoseApolloLiteRuntime(config);
    res.status(result.ready ? 200 : 500).json({
      code: result.ready ? 0 : 15056,
      message: result.ready ? "Success" : "ApolloLite runtime needs repair",
      data: result,
    });
  } catch (error) {
    sendError(res, 500, 15056, error.message);
  }
});

app.get("/runtime/apollolite/workflow", requirePermission("canView"), async (_req, res) => {
  try {
    const result = await runtime.getApolloLiteWorkflow(config);
    res.status(result.ready ? 200 : 500).json({
      code: result.ready ? 0 : 15058,
      message: result.ready ? "Success" : "ApolloLite workflow is not ready",
      data: result,
    });
  } catch (error) {
    sendError(res, 500, 15058, error.message);
  }
});

app.post(
  "/runtime/apollolite/repair-job",
  requirePermission("canDeploy"),
  async (_req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "repair-apollolite-runtime",
        (runtimeJob) =>
          runtime.repairApolloLiteRuntime(config, (message) =>
            updateRuntimeJobProgress(runtimeJob, message),
          ),
        {},
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15057, error.message);
    }
  },
);

app.post(
  "/runtime/apollolite/reset-simulation-job",
  requirePermission("canEdit"),
  async (_req, res) => {
    try {
      const job = startRuntimeJob(
        "reset-apollolite-simulation",
        (runtimeJob) =>
          runtime.resetApolloLiteSimulationSession(config, (message) =>
            updateRuntimeJobProgress(runtimeJob, message),
          ),
        {},
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15059, error.message);
    }
  },
);

app.get("/runtime/apollolite/traffic-light-sim", requirePermission("canView"), async (_req, res) => {
  try {
    const result =
      await runtime.getApolloLiteTrafficLightSimulationStatus(config);
    res.status(result.available ? 200 : 500).json({
      code: result.available ? 0 : 15060,
      message:
        result.message ||
        (result.available
          ? "Success"
          : "Traffic light simulation status unavailable"),
      data: result,
    });
  } catch (error) {
    sendError(res, 500, 15060, error.message);
  }
});

app.post(
  "/runtime/apollolite/traffic-light-sim/start",
  requirePermission("canEdit"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const result = await runtime.startApolloLiteTrafficLightSimulation(
        config,
        {
          color: body.color || "GREEN",
          interval: body.interval,
        },
      );
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      sendError(res, 500, 15061, error.message);
    }
  },
);

app.post(
  "/runtime/apollolite/traffic-light-sim/stop",
  requirePermission("canEdit"),
  async (_req, res) => {
    try {
      const result = await runtime.stopApolloLiteTrafficLightSimulation(config);
      res.json({
        code: 0,
        message: "Success",
        data: result,
      });
    } catch (error) {
      sendError(res, 500, 15062, error.message);
    }
  },
);

app.post(
  "/runtime/apollolite-stage-map-job",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const body = req.body || {};
      const job = startRuntimeJob(
        "stage-apollolite-map",
        (runtimeJob) =>
          runtime.stageReleasedMapToApolloLite(config, {
            mapName: body.mapName || "",
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {
          mapName: body.mapName || "",
        },
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15053, error.message);
    }
  },
);

app.post(
  "/runtime/apollolite-stage-latest-job",
  requirePermission("canDeploy"),
  async (_req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "stage-apollolite-map",
        (runtimeJob) =>
          runtime.stageReleasedMapToApolloLite(config, {
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {},
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15054, error.message);
    }
  },
);

app.post(
  "/runtime/apollolite-sim-smoke-test-job",
  requirePermission("canEdit"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const job = startRuntimeJob(
        "apollolite-sim-smoke-test",
        (runtimeJob) =>
          runtime.runApolloLiteSimulationSmokeTest(config, {
            mapName: body.mapName || "",
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {
          mapName: body.mapName || "",
        },
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15055, error.message);
    }
  },
);

app.post(
  "/runtime/preflight-deploy",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const result = await runtime.preflightEdgeDeploy(config, req.body || {});
      const preflightErrors = summarizePreflightErrors(result);
      res.status(200).json({
        code: result.ready ? 0 : 15042,
        message: result.ready
          ? "Success"
          : `Preflight failed${preflightErrors ? `: ${preflightErrors}` : ""}`,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        code: 15042,
        message: error.message,
        data: error.result || null,
      });
    }
  },
);

app.post("/runtime/create-base-map", requirePermission("canEdit"), async (req, res) => {
  try {
    const result = await runtime.createBaseMap(config, req.body || {});
    res.json({
      code: 0,
      message: "Success",
      data: {
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 15030,
      message: error.message,
      data: error.result || null,
    });
  }
});

app.get("/mapcreator/:mapName/point_cloud/index.json", async (req, res) => {
  const { mapName } = req.params;
  const indexPath = path.join(
    config.baseMapRoot,
    mapName,
    "point_cloud",
    "index.json",
  );
  if (!(await pathExists(indexPath))) {
    res
      .status(404)
      .json({ code: 404, message: `point_cloud/index.json not found for ${mapName}` });
    return;
  }
  try {
    const content = await fsp.readFile(indexPath, "utf8");
    lastAccessedBaseMapDir = path.join(config.baseMapRoot, mapName);
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=300");
    res.type("application/json").send(content);
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

app.get("/mapcreator/:mapName/point_cloud/blocks/:file", async (req, res) => {
  const { mapName, file } = req.params;
  const safeFile = path.basename(file);
  if (safeFile !== file || !safeFile.endsWith(".bin")) {
    res.status(404).send("Not Found");
    return;
  }
  const blockPath = path.join(
    config.baseMapRoot,
    mapName,
    "point_cloud",
    "blocks",
    safeFile,
  );
  if (!(await pathExists(blockPath))) {
    res.status(404).send("Not Found");
    return;
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=300");
  res.type("application/octet-stream").sendFile(blockPath);
});

app.post(
  "/runtime/deploy-map-job",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "deploy-map",
        (runtimeJob) =>
          runtime.deployReleasedMap(config, {
            ...body,
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {
          mapName: body.mapName || "",
        },
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15047, error.message);
    }
  },
);

app.post(
  "/runtime/deploy-latest-job",
  requirePermission("canDeploy"),
  async (_req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "deploy-latest",
        (runtimeJob) =>
          runtime.deployLatestReleasedMap(config, {
            progress: (message) =>
              updateRuntimeJobProgress(runtimeJob, message),
          }),
        {},
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15048, error.message);
    }
  },
);

app.post(
  "/runtime/rollback-deployment-job",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const body = req.body || {};
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const job = startRuntimeJob(
        "rollback-deployment",
        () => runtime.rollbackDeployment(config, body),
        {
          deploymentId: body.deploymentId || "",
          mapName: body.mapName || "",
        },
      );
      sendAcceptedJob(res, job);
    } catch (error) {
      sendError(res, 500, 15049, error.message);
    }
  },
);

app.post(
  "/runtime/deploy-map",
  requirePermission("canDeploy"),
  async (req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const result = await runtime.deployReleasedMap(config, req.body || {});
      sendSuccess(res, result);
    } catch (error) {
      sendError(res, 500, 15040, error.message, error.result || null);
    }
  },
);

app.post(
  "/runtime/deploy-latest",
  requirePermission("canDeploy"),
  async (_req, res) => {
    try {
      const activeJob = findActiveHeavyRuntimeJob();
      if (activeJob) {
        sendRuntimeJobBusy(res, activeJob);
        return;
      }
      const result = await runtime.deployLatestReleasedMap(config);
      sendSuccess(res, result);
    } catch (error) {
      sendError(res, 500, 15041, error.message, error.result || null);
    }
  },
);

app.get("/mapcreator/:mapName/tiles.json", async (req, res) => {
  const { mapName } = req.params;
  const tilePath = path.join(
    config.baseMapRoot,
    mapName,
    "map_images",
    "tiles.json",
  );
  if (!(await pathExists(tilePath))) {
    res
      .status(404)
      .json({ code: 404, message: `tiles.json not found for ${mapName}` });
    return;
  }
  try {
    const content = await fsp.readFile(tilePath, "utf8");
    lastAccessedBaseMapDir = path.join(config.baseMapRoot, mapName);
    res.set("Access-Control-Allow-Origin", "*");
    res.type("application/json").send(content);
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

app.get("/mapcreator/:mapName/layers/:layer/tiles.json", async (req, res) => {
  const { mapName, layer } = req.params;
  const layerDir = getBaseMapLayerDir(layer);
  if (!layerDir) {
    res
      .status(404)
      .json({ code: 404, message: `unknown base map layer: ${layer}` });
    return;
  }
  const tilePath = path.join(
    config.baseMapRoot,
    mapName,
    layerDir,
    "tiles.json",
  );
  if (!(await pathExists(tilePath))) {
    res
      .status(404)
      .json({
        code: 404,
        message: `tiles.json not found for ${mapName}/${layer}`,
      });
    return;
  }
  try {
    const payload = JSON.parse(
      (await fsp.readFile(tilePath, "utf8")).replace(/^\uFEFF/, ""),
    );
    payload.layerId = layer;
    lastAccessedBaseMapDir = path.join(config.baseMapRoot, mapName);
    res.set("Access-Control-Allow-Origin", "*");
    res.type("application/json").send(JSON.stringify(payload));
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

app.get("/mapcreator/:mapName/:level/proj.png", async (req, res) => {
  const { mapName, level } = req.params;
  const pngPath = path.join(
    config.baseMapRoot,
    mapName,
    "traffic_light_data",
    level,
    "proj.png",
  );
  if (!(await pathExists(pngPath))) {
    res.status(404).send("Not Found");
    return;
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=300");
  res.sendFile(pngPath);
});

app.get("/mapcreator/:mapName/source_images/:file", async (req, res) => {
  const { mapName, file } = req.params;
  const imagePath = path.join(
    config.baseMapRoot,
    mapName,
    "source_images",
    file,
  );
  if (!(await pathExists(imagePath))) {
    res.status(404).send("Not Found");
    return;
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.sendFile(imagePath);
});

app.get("/mapcreator/:mapName/image_index.json", async (req, res) => {
  const { mapName } = req.params;
  const indexPath = path.join(config.baseMapRoot, mapName, "image_index.json");
  if (!(await pathExists(indexPath))) {
    res
      .status(404)
      .json({
        code: 404,
        message: `image_index.json not found for ${mapName}`,
      });
    return;
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.sendFile(indexPath);
});

app.get(
  "/mapcreator/:mapName/layers/:layer/:level/:y/:file",
  async (req, res) => {
    const { mapName, layer, level, y, file } = req.params;
    const layerDir = getBaseMapLayerDir(layer);
    if (!layerDir) {
      res.status(404).send("Not Found");
      return;
    }
    const pngPath = path.join(
      config.baseMapRoot,
      mapName,
      layerDir,
      level,
      y,
      file,
    );
    if (!(await pathExists(pngPath))) {
      res.status(404).send("Not Found");
      return;
    }
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Cache-Control", "public, max-age=300");
    res.sendFile(pngPath);
  },
);

app.get("/mapcreator/:mapName/:level/:y/:file", async (req, res) => {
  const { mapName, level, y, file } = req.params;
  const pngPath = path.join(
    config.baseMapRoot,
    mapName,
    "map_images",
    level,
    y,
    file,
  );
  if (!(await pathExists(pngPath))) {
    res.status(404).send("Not Found");
    return;
  }
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=300");
  res.sendFile(pngPath);
});

app.use("/dreamview", (req, res) => {
  if (req.originalUrl === "/dreamview") {
    res.redirect(302, "/dreamview/");
    return;
  }
  proxyDreamviewHttp(req, res);
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/mapcreator/") || req.path === "/healthz") {
    next();
    return;
  }
  const indexPath = path.join(config.frontendBuildRoot, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
    return;
  }
  res.status(404).json({
    code: 404,
    message:
      "Frontend build not found. Run npm run build in frontend or use npm run dev.",
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/dreamview" || req.url?.startsWith("/dreamview/")) {
    handleDreamviewUpgrade(req, socket, head);
    return;
  }
  for (const listener of existingUpgradeListeners) {
    listener.call(server, req, socket, head);
  }
});

server.listen(config.port, async () => {
  await Promise.all([
    ensureDir(config.baseMapRoot),
    ensureDir(config.editorMapRoot),
    ensureDir(config.releaseRoot),
  ]);
  startCaptureAutoSyncScheduler();
  startInboxAutoPrebuildScheduler();
  log(`Simple map backend listening on ${config.port}`);
  log("Base map root:", config.baseMapRoot);
  log("Editor map root:", config.editorMapRoot);
  log("Release root:", config.releaseRoot);
  log("Converter binary:", config.converterBinary);
  log("Frontend build root:", config.frontendBuildRoot);
});
