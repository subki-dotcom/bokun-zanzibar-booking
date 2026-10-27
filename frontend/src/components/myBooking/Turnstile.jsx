import { useEffect, useRef } from "react";

const SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || "").trim();
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

const loadScript = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error("Turnstile failed to load"));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
};

export const turnstileEnabled = Boolean(SITE_KEY);

// Cloudflare Turnstile bot check (only when VITE_TURNSTILE_SITE_KEY is set). onToken("") when it expires;
// onError(code) when the check cannot run (e.g. 110200: this domain is not allowed for the site key).
const Turnstile = ({ onToken, onError = () => {}, resetSignal = 0 }) => {
  const box = useRef(null);
  const widget = useRef(null);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!SITE_KEY) return undefined;
    let cancelled = false;
    loadScript()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        widget.current = turnstile.render(box.current, {
          sitekey: SITE_KEY,
          size: "flexible",
          callback: (token) => {
            errorRef.current("");
            tokenRef.current(token);
          },
          "expired-callback": () => tokenRef.current(""),
          "error-callback": (code) => {
            tokenRef.current("");
            errorRef.current(String(code || "error"));
            // Handled here: no automatic retry loop.
            return true;
          }
        });
      })
      .catch(() => {
        tokenRef.current("");
        errorRef.current("script");
      });
    return () => {
      cancelled = true;
      if (widget.current !== null && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetSignal && widget.current !== null && window.turnstile) window.turnstile.reset(widget.current);
  }, [resetSignal]);

  return SITE_KEY ? <div className="mb-turnstile" ref={box} /> : null;
};

export default Turnstile;
