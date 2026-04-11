const fetch = require("node-fetch");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const path = require("path");
const fs = require("fs");

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;

if (!GITHUB_TOKEN || !GITHUB_REPO) {
	console.error("Missing env vars: GITHUB_TOKEN and GITHUB_REPO must be set in Netlify dashboard → Site Settings → Environment Variables");
}

const headers = {
	Authorization: `Bearer ${GITHUB_TOKEN}`,
	Accept: "application/vnd.github.v3+json",
};

// Register handwritten font — try both local dev path and Netlify bundle path
function registerFont(filename, family) {
	const candidates = [path.join(__dirname, "../fonts", filename), path.join(__dirname, "fonts", filename)];
	const found = candidates.find((p) => fs.existsSync(p));
	if (found) {
		GlobalFonts.registerFromPath(found, family);
	} else {
		console.warn(`Font "${family}" not found at:`, candidates);
	}
}

registerFont("IndieFlower-Regular.ttf", "Indie Flower");

async function fetchFromGitHub(filePath, raw = false) {
	const res = await fetch(`${GITHUB_API}/${filePath}`, raw ? { headers: { ...headers, Accept: "application/vnd.github.v3.raw" } } : { headers });
	if (!res.ok) {
		if (res.status === 401) throw new Error("GitHub auth failed — GITHUB_TOKEN env var is missing or invalid");
		if (res.status === 404) return null;
		throw new Error(`GitHub returned ${res.status} for ${filePath}`);
	}
	if (raw) {
		return await res.buffer();
	}
	const data = await res.json();
	return Buffer.from(data.content, "base64");
}

exports.handler = async (event) => {
	// Parse path: /image/:client/:name → Netlify rewrites to /.netlify/functions/image/:client/:name
	const rawPath = event.path || "";
	// Strip function path prefix. Netlify may pass either the rewritten path
	// (/.netlify/functions/image/...) or the original request path (/image/...).
	let requestPath = rawPath.replace(/^\/\.netlify\/functions\/image/, "").replace(/^\/image/, "");

	// Also handle query param fallback for backwards compat
	const params = event.queryStringParameters || {};

	let client, name;

	// Path-based: /clientSlug/PersonName (after prefix strip)
	const pathMatch = requestPath.match(/^\/([^/]+)\/(.+?)(\?.*)?$/);
	if (pathMatch) {
		client = decodeURIComponent(pathMatch[1]);
		name = decodeURIComponent(pathMatch[2]);
	}

	// Fallback to query params: ?client=excl-outdoor&name=Sarah
	if (!client) client = params.client;
	if (!name) name = params.name;

	if (!client || !name) {
		return {
			statusCode: 400,
			body: "Usage: /image/{client}/{name} or /image?client=x&name=y",
		};
	}

	try {
		// Prefix "Hey " to the name
		const displayText = `Hey ${name}`;

		// Fetch config via authenticated GitHub API
		const configBuffer = await fetchFromGitHub(`clients/${client}/config.json`);
		if (!configBuffer) {
			return {
				statusCode: 404,
				body: `Client "${client}" config not found`,
			};
		}
		const config = JSON.parse(configBuffer.toString("utf8"));

		// Fetch base image via authenticated GitHub API (raw mode for large files)
		const imageBuffer = await fetchFromGitHub(`clients/${client}/base.jpg`, true);
		if (!imageBuffer) {
			return {
				statusCode: 404,
				body: `Base image for "${client}" not found`,
			};
		}

		// Load image into canvas
		const img = await loadImage(imageBuffer);
		const canvas = createCanvas(img.width, img.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0);

		// Autofit text into bounding box
		const { box, font, color, align, angle: angleDeg = 0, bg } = config;
		const fontFamily = font || "Indie Flower";

		if (!box || box.width <= 0 || box.height <= 0) {
			return {
				statusCode: 400,
				body: `Client "${client}" has no bounding box configured. Edit the client in the admin panel to draw a text area.`,
			};
		}

		let fontSize = box.height; // start at max possible
		let textWidth;

		ctx.textBaseline = "top";
		while (fontSize > 1) {
			ctx.font = `${fontSize}px "${fontFamily}"`;
			const metrics = ctx.measureText(displayText);
			textWidth = metrics.width;

			if (textWidth <= box.width && fontSize <= box.height) {
				break;
			}
			fontSize -= 1;
		}

		// Relative x position within box (origin = box center)
		let relX;
		if (align === "left") {
			relX = -box.width / 2;
		} else if (align === "right") {
			relX = box.width / 2 - textWidth;
		} else {
			relX = -textWidth / 2;
		}
		const relY = -fontSize / 2; // vertically centered

		// Translate to box center, rotate, then draw background + text
		const cx = box.x + box.width / 2;
		const cy = box.y + box.height / 2;

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate((angleDeg * Math.PI) / 180);

		// Draw background rectangle tight around the text
		if (bg && bg.enabled) {
			const pad = bg.padding ?? 8;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(relX - pad, relY - pad, textWidth + pad * 2, fontSize + pad * 2);
		}

		// Draw text
		ctx.fillStyle = "#000000";
		ctx.font = `${fontSize}px "${fontFamily}"`;
		ctx.fillText(displayText, relX, relY);

		ctx.restore();

		// Return rendered image
		const outputBuffer = await canvas.encode("jpeg", 95);

		return {
			statusCode: 200,
			headers: {
				"Content-Type": "image/jpeg",
				"Cache-Control": "public, max-age=60",
			},
			body: outputBuffer.toString("base64"),
			isBase64Encoded: true,
		};
	} catch (err) {
		console.error("Image render error:", err);
		return {
			statusCode: 500,
			body: "Error rendering image: " + err.message,
		};
	}
};
