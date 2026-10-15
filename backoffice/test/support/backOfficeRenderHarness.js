// Renders the real Back Office (routes, guards, layout, AuthProvider) in JSDOM. The shared axiosClient is
// answered by an in-test adapter that plays the server: it records every call and refuses (403) any route
// the test does not define, as the backend refuses anything a role may not read. No network is used.
// Not a test file itself (the runner only picks up test/*.test.js).
import { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { sharedResolve } from "../../../shared/vite.shared.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const serverError = (status, code, message) => ({ __error: { status, code, message } });

// websiteAdmin: render the admin the way the website mounts it (adminRoutes({ websiteAdmin: true })).
export const createRenderHarness = ({ defaultRoutes = () => ({}), websiteAdmin = false } = {}) => {
  const state = { dom: null, server: null, mods: null, reactRoot: null, calls: [], routes: {}, currentUser: null, locationNow: "" };

  before(async () => {
    state.dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost:5174/", pretendToBeVisual: true });
    for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Node", "Event", "CustomEvent", "MouseEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "localStorage", "sessionStorage"]) {
      try {
        const value = state.dom.window[name];
        Object.defineProperty(globalThis, name, { value: typeof value === "function" && /^[a-z]/.test(name) ? value.bind(state.dom.window) : value, configurable: true, writable: true });
      } catch { /* read-only in this Node version */ }
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    state.server = await createServer({ configFile: false, resolve: sharedResolve, esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true }, appType: "custom" });
    state.mods = {
      routes: await state.server.ssrLoadModule("/src/routes/BackOfficeRoutes.jsx"),
      adminRoutes: await state.server.ssrLoadModule("/src/routes/AdminRoutes.jsx"),
      auth: await state.server.ssrLoadModule("/../shared/src/context/AuthContext.jsx"),
      axios: await state.server.ssrLoadModule("/../shared/src/api/axiosClient.js"),
      router: await import("react-router-dom"),
      client: await import("react-dom/client")
    };
  });

  after(async () => {
    await state.server?.close();
    state.dom?.window.close();
  });

  beforeEach(() => {
    state.calls = [];
    state.routes = defaultRoutes();
    state.mods.axios.default.defaults.adapter = async (config) => {
      const url = new URL(config.url, "http://api.test/api");
      const method = String(config.method || "get").toUpperCase();
      const pathname = url.pathname.replace(/^\/api/, "");
      const body = config.data ? JSON.parse(config.data) : {};
      state.calls.push({ method, pathname, query: url.searchParams, body, headers: config.headers });
      const handler = state.routes[`${method} ${pathname}`];
      const result = handler ? await handler({ user: state.currentUser, query: url.searchParams, body }) : serverError(403, "FORBIDDEN", "Forbidden");
      if (result?.__error) {
        return Promise.reject({ config, response: { status: result.__error.status, data: { success: false, message: result.__error.message, error: { code: result.__error.code } } } });
      }
      return { data: { success: true, message: "ok", data: result }, status: 200, statusText: "OK", headers: {}, config };
    };
  });

  const unmount = async () => {
    if (!state.reactRoot) return;
    const root = state.reactRoot;
    state.reactRoot = null;
    await act(async () => { root.unmount(); await sleep(10); });
    document.body.innerHTML = "<div id=\"root\"></div>";
  };

  afterEach(unmount);

  const LocationProbe = () => {
    const location = state.mods.router.useLocation();
    state.locationNow = `${location.pathname}${location.search}`;
    return null;
  };

  const mount = async (pathname, user) => {
    await unmount();
    state.currentUser = user;
    localStorage.clear();
    if (user) {
      localStorage.setItem("zanzibar_auth_token", "test-token");
      localStorage.setItem("zanzibar_auth_user", JSON.stringify(user));
    }
    state.reactRoot = state.mods.client.createRoot(document.getElementById("root"));
    await act(async () => {
      state.reactRoot.render(
        React.createElement(state.mods.router.MemoryRouter, { initialEntries: [pathname] },
          React.createElement(state.mods.auth.AuthProvider, null,
            websiteAdmin
              ? React.createElement(React.Suspense, { fallback: null },
                React.createElement(state.mods.router.Routes, null, state.mods.adminRoutes.default({ websiteAdmin: true })))
              : React.createElement(state.mods.routes.default),
            React.createElement(LocationProbe)))
      );
      await sleep(20);
    });
  };

  const text = () => document.body.textContent || "";
  const waitFor = async (predicate, label = "condition") => {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (predicate()) return;
      await act(async () => { await sleep(20); });
    }
    assert.fail(`Timed out waiting for ${label}. Location ${state.locationNow}. Text: ${text().slice(0, 400)}`);
  };
  const buttons = () => [...document.querySelectorAll("button")];
  const button = (label) => buttons().find((element) => element.textContent.trim() === label);
  const click = async (element) => {
    await act(async () => { element.dispatchEvent(new state.dom.window.MouseEvent("click", { bubbles: true })); await sleep(10); });
  };
  const setValue = async (element, value) => {
    const { window } = state.dom;
    const prototype = element.tagName === "SELECT" ? window.HTMLSelectElement.prototype : element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    await act(async () => {
      element.dispatchEvent(new window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      await sleep(5);
    });
  };
  const submit = async (form) => {
    await act(async () => { form.dispatchEvent(new state.dom.window.Event("submit", { bubbles: true, cancelable: true })); await sleep(10); });
  };

  return {
    mount,
    unmount,
    text,
    waitFor,
    buttons,
    button,
    click,
    setValue,
    submit,
    sleep,
    act,
    get dom() { return state.dom; },
    get calls() { return state.calls; },
    get routes() { return state.routes; },
    get locationNow() { return state.locationNow; },
    apiPaths: () => state.calls.map((call) => `${call.method} ${call.pathname}`)
  };
};
