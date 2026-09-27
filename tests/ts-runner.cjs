const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {}

if (!process.env.NODE_ENV && (!process.argv[2] || process.argv[2].includes("test"))) {
  process.env.NODE_ENV = "test";
}
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

// Load .env.local and .env if present
for (const envFile of [".env.local", ".env"]) {
  const envPath = path.join(ROOT, envFile);
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

// Handle module resolution for @/*
const originalResolveFilename = require("module")._resolveFilename;
require("module")._resolveFilename = function (request, parent, isMain) {
  if (request.startsWith("@/")) {
    const rel = request.slice(2);
    const candidatePaths = [
      path.join(ROOT, "src", rel + ".ts"),
      path.join(ROOT, "src", rel + ".tsx"),
      path.join(ROOT, "src", rel, "index.ts"),
      path.join(ROOT, "src", rel, "index.tsx"),
      path.join(ROOT, "src", rel + ".js"),
      path.join(ROOT, "src", rel),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) {
        return originalResolveFilename.call(this, p, parent, isMain);
      }
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};

// Handle compilation for .ts and .tsx
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const result = ts.transpileModule(content, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      jsx: ts.JsxEmit.React,
    },
  });
  module._compile(result.outputText, filename);
};

require.extensions[".tsx"] = require.extensions[".ts"];

const testFile = process.argv[2] || "./tests/commerce-tests.ts";
require(path.resolve(process.cwd(), testFile));
