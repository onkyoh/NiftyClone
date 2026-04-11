const fs = require("fs");
const path = require("path");
const { isAuthenticated, makSetCookieHeader } = require("./lib/auth");

const LOGIN_FORM = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nifty — Sign In</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 2rem;
      width: 100%;
      max-width: 360px;
      box-shadow: 0 4px 24px rgba(0,0,0,.07);
    }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
    p  { font-size: 0.875rem; color: #666; margin-bottom: 1.5rem; }
    label { display: block; font-size: 0.8rem; font-weight: 500; color: #555; margin-bottom: 0.25rem; }
    input[type="password"] {
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.875rem;
      margin-bottom: 1rem;
      transition: border-color .15s;
    }
    input[type="password"]:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,.1); }
    button {
      width: 100%;
      padding: 0.6rem 1rem;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    .error { color: #ef4444; font-size: 0.8rem; margin-top: 0.75rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Nifty</h1>
    <p>Image Personalization Admin</p>
    <form method="POST" action="/.netlify/functions/admin">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required>
      <button type="submit">Sign In</button>
      {{ERROR}}
    </form>
  </div>
</body>
</html>`;

function serveAdmin(event) {
  // Try to read admin/index.html — check two locations (local dev vs bundled)
  const candidates = [
    path.join(__dirname, "../admin/index.html"),
    path.join(__dirname, "admin/index.html"),
  ];
  const htmlPath = candidates.find((p) => fs.existsSync(p));
  if (!htmlPath) {
    return { statusCode: 500, body: "Admin UI not found" };
  }

  let html = fs.readFileSync(htmlPath, "utf8");

  // Rewrite asset paths so they still load when served from /.netlify/functions/admin
  // The admin dir is the Netlify publish dir, so style.css and app.js are at /style.css and /app.js
  // No rewrite needed — publish dir is admin/, so /style.css and /app.js resolve correctly.

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
    body: html,
  };
}

exports.handler = async (event) => {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.COOKIE_SECRET;

  if (!password || !secret) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: "ADMIN_PASSWORD and COOKIE_SECRET env vars must be set",
    };
  }

  // GET — check cookie, serve admin or login form
  if (event.httpMethod === "GET") {
    if (isAuthenticated(event)) {
      return serveAdmin(event);
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: LOGIN_FORM.replace("{{ERROR}}", ""),
    };
  }

  // POST — handle login form submission
  if (event.httpMethod === "POST") {
    let submitted = "";
    try {
      const params = new URLSearchParams(event.body || "");
      submitted = params.get("password") || "";
    } catch (_) {}

    if (submitted !== password) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        body: LOGIN_FORM.replace("{{ERROR}}", '<p class="error">Incorrect password.</p>'),
      };
    }

    // Correct — set cookie and redirect to admin
    return {
      statusCode: 302,
      headers: {
        Location: "/",
        "Set-Cookie": makSetCookieHeader(secret),
      },
      body: "",
    };
  }

  return { statusCode: 405, body: "Method Not Allowed" };
};
