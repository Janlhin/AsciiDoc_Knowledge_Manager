/**
 * Minimal Chrome DevTools Protocol client for the WebView2 in Geode's release
 * build. No Playwright, no webdriver, no new dependency: Node's http + the
 * `ws` package that ships with the existing toolchain.
 *
 * WebView2 binds the debug port on IPv6 ::1 (localhost works, 127.0.0.1 does
 * not), which is why the host is hardcoded here.
 */
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const WebSocket = require("ws");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tryHost(host, port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: pathname }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(2500, () => req.destroy(new Error("CDP timeout")));
  });
}

/** Probe ::1 first, then IPv4 loopback: WebView2 may bind either stack. */
async function getJson(port, pathname) {
  let last;
  for (const host of ["::1", "127.0.0.1"]) {
    try {
      return await tryHost(host, port, pathname);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Poll /json/version until the webview is up. */
export async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await getJson(port, "/json/version");
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`CDP port ${port} did not open within ${timeoutMs} ms`);
}

/** Open a session on the first page target. */
export async function connectCdp(port = 9222) {
  const targets = await getJson(port, "/json/list");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no CDP page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  let seq = 0;
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const on = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.id !== id) return;
        ws.off("message", on);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      };
      ws.on("message", on);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await call("Runtime.evaluate", {
      expression: `(async () => { return (${expression}); })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)}`);
    }
    return r.result?.value;
  };

  /** Real key events (Ctrl+P etc.) so framework handlers see trusted input. */
  const key = async (keyName, code, vk, modifiers = 0) => {
    const base = {
      key: keyName,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    };
    await call("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await call("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };

  const click = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

  const setInput = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

  /** Click with real CDP mouse events at the element's centre. Needed for
   *  handlers bound to inner buttons (the outline row is one such case). */
  const realClick = async (selector, index = 0) => {
    const box = await evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${index}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
      await call("Input.dispatchMouseEvent", {
        type, x: box.x, y: box.y, button: "left", clickCount: 1,
      });
    }
    return true;
  };

  /** Wait until `expression` evaluates truthy; returns the last value. */
  async function waitFor(expression, timeoutMs = 8000, label = expression) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await evaluate(expression);
      if (last) return last;
      await sleep(150);
    }
    throw new Error(`waitFor timed out: ${label} (last=${JSON.stringify(last)})`);
  }

  return { evaluate, key, click, realClick, setInput, waitFor, call, close: () => ws.close() };
}
