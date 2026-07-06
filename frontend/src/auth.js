// ---------- Authentication helpers ----------
// A front-end session gate for the prototype: email/password and Google
// OAuth 2.0 (via Google Identity Services). There is no backend here, so the
// email/password path validates format only and the session lives in the
// browser. In production this would verify credentials server-side.

const SESSION_KEY = "stakeholder-translator.session";

// Configure in a .env file at the project root (see .env.example):
//   VITE_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
export const GOOGLE_CLIENT_ID =
  (() => {
    if (typeof import.meta !== "undefined") {
      return import.meta.env?.VITE_GOOGLE_CLIENT_ID || "";
    }
    return "";
  })();

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(user) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    /* storage may be unavailable; caller keeps it in memory */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Decode a JWT payload (base64url, UTF-8 safe) — used for the Google ID token.
export function decodeJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Lazy-load the Google Identity Services script exactly once.
let gsiPromise = null;
export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google);
      else reject(new Error("Google Identity Services failed to initialise."));
    };
    s.onerror = () => reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(s);
  });
  return gsiPromise;
}
