const crypto = require("crypto");

const COOKIE_NAME = "nifty_auth";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function hmac(secret, value) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function makeCookieValue(secret) {
  const ts = Date.now().toString(36);
  const sig = hmac(secret, ts);
  return `${ts}.${sig}`;
}

function isValidCookieValue(secret, value) {
  if (!value) return false;
  const [ts, sig] = value.split(".");
  if (!ts || !sig) return false;
  const expected = hmac(secret, ts);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (k) cookies[k.trim()] = rest.join("=").trim();
  });
  return cookies;
}

function isAuthenticated(event) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) return false;
  const cookies = parseCookies(event.headers["cookie"] || event.headers["Cookie"] || "");
  return isValidCookieValue(secret, cookies[COOKIE_NAME]);
}

function makSetCookieHeader(secret) {
  const value = makeCookieValue(secret);
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

module.exports = { isAuthenticated, makSetCookieHeader, COOKIE_NAME };
