// Drives headless Chrome via the DevTools Protocol to screenshot each
// dashboard tab. Produces PNGs in media/screenshots/.
//
// Usage: node scripts/screenshot.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const CDP = require("chrome-remote-interface");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const HARNESS_URL = "file://" + path.join(EXT_ROOT, "scripts", "screenshot-harness.html");
const OUT_DIR = path.join(EXT_ROOT, "media", "screenshots");

const TABS = [
  { id: "overview", file: "tab-overview.png" },
  { id: "models", file: "tab-models.png" },
  { id: "cost", file: "tab-cost.png" },
  { id: "cache", file: "tab-cache.png" },
  { id: "team", file: "tab-team.png" },
];

const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function main() {
  const port = 9333 + Math.floor(Math.random() * 1000);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--window-size=980,1100`,
    ],
    { stdio: "ignore" }
  );
  chrome.unref();
  // Wait for Chrome's DevTools endpoint to come up.
  await waitForDevTools(port, 15_000);

  let client;
  try {
    client = await CDP({ port });
    const { Page, Runtime } = client;
    await Page.enable();
    await Runtime.enable();
    await Page.navigate({ url: HARNESS_URL });
    await Page.loadEventFired();
    // Wait until the dashboard script signals it has rendered all tabs.
    await Runtime.evaluate({
      expression:
        "new Promise((r)=>{const t=setInterval(()=>{if(window.__DASHBOARD_READY){clearInterval(t);r(true);}},30);})",
      awaitPromise: true,
      returnByValue: true,
    });

    const { fs: _unused } = {}; // fs imported at top
    await fs.mkdir(OUT_DIR, { recursive: true });

    for (const tab of TABS) {
      // Activate the tab, then measure the content height for a full shot.
      await Runtime.evaluate({
        expression: `(()=>{
          const btn=document.querySelector('.tab[data-tab="${tab.id}"]');
          if(btn) btn.click();
          return true;
        })();`,
        returnByValue: true,
      });
      // Let the fade animation + layout settle.
      await sleep(250);

      const dim = await Runtime.evaluate({
        expression:
          "JSON.stringify({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})",
        returnByValue: true,
      });
      const { w, h } = JSON.parse(dim.result.value);
      await Page.setDeviceMetricsOverride({
        width: Math.min(980, w),
        height: Math.min(1400, h),
        deviceScaleFactor: 2,
        mobile: false,
      });
      await sleep(120);
      const shot = await Page.captureScreenshot({ format: "png" });
      const outPath = path.join(OUT_DIR, tab.file);
      await fs.writeFile(outPath, Buffer.from(shot.data, "base64"));
      console.log(`wrote ${outPath}`);
    }
  } finally {
    if (client) await client.close();
    chrome.kill("SIGTERM");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDevTools(port, timeoutMs) {
  const http = await import("node:http");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
          res.resume();
          res.on("end", () => resolve(true));
        });
        req.on("error", () => resolve(false));
        req.setTimeout(500, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    } catch {
      // keep trying
    }
    await sleep(300);
  }
  throw new Error(`Chrome DevTools endpoint on port ${port} did not come up within ${timeoutMs}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
