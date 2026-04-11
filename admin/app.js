(function () {
  "use strict";

  // ── Config (loaded from Netlify function at runtime) ──
  let GITHUB_API = "";
  const headers = {
    Authorization: "",
    Accept: "application/vnd.github.v3+json",
  };

  // ── State ──
  let clients = [];
  let editingSlug = null; // null = new client
  let baseImageFile = null; // File object for upload
  let baseImageEl = null; // HTMLImageElement for canvas
  let box = { x: 0, y: 0, width: 0, height: 0 };
  let angle = 0;
  let bg = { enabled: false, color: "#000000", opacity: 0.5, padding: 8 };
  let isDrawing = false;
  let drawStart = { x: 0, y: 0 };

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const screenList = $("#screen-list");
  const screenEditor = $("#screen-editor");
  const clientListEl = $("#client-list");
  const btnAddClient = $("#btn-add-client");
  const btnBack = $("#btn-back");
  const btnDelete = $("#btn-delete");
  const editorTitle = $("#editor-title");
  const clientNameInput = $("#client-name");
  const clientSlugInput = $("#client-slug");
  const uploadArea = $("#upload-area");
  const fileInput = $("#file-input");
  const uploadLabel = $("#upload-label");
  const boxX = $("#box-x");
  const boxY = $("#box-y");
  const boxW = $("#box-w");
  const boxH = $("#box-h");
  const btnSave = $("#btn-save");
  const btnPreview = $("#btn-preview");
  const saveStatus = $("#save-status");
  const canvasWrapper = $("#canvas-wrapper");
  const previewCanvas = $("#preview-canvas");
  const previewModal = $("#preview-modal");
  const btnCloseModal = $("#btn-close-modal");
  const previewNameInput = $("#preview-name");
  const previewImage = $("#preview-image");
  const previewStatus = $("#preview-status");
  const textAngleInput = $("#text-angle");
  const bgEnabled = $("#bg-enabled");
  const bgOptions = $("#bg-options");
  const bgPaddingInput = $("#bg-padding");

  // ── GitHub API helpers ──
  async function githubGet(path) {
    const res = await fetch(`${GITHUB_API}/${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
    return res.json();
  }

  async function githubDelete(filePath) {
    const existing = await githubGet(filePath);
    const res = await fetch(`${GITHUB_API}/${filePath}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({
        message: `Delete ${filePath}`,
        sha: existing.sha,
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `GitHub DELETE ${filePath}: ${res.status}`);
    }
  }

  async function githubPut(path, content, isBase64 = false) {
    // Need current SHA for updates
    let sha = null;
    try {
      const existing = await githubGet(path);
      sha = existing.sha;
    } catch {
      // File doesn't exist yet — that's fine for new files
    }

    const body = {
      message: `Update ${path}`,
      content: isBase64 ? content : btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;

    const res = await fetch(`${GITHUB_API}/${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || `GitHub PUT ${path}: ${res.status}`);
    }
    return res.json();
  }

  // ── Screen navigation ──
  function showList() {
    screenList.classList.remove("hidden");
    screenEditor.classList.add("hidden");
    editingSlug = null;
    baseImageFile = null;
    baseImageEl = null;
    loadClients();
  }

  function showEditor(slug) {
    screenList.classList.add("hidden");
    screenEditor.classList.remove("hidden");
    editingSlug = slug;
    resetForm();
    saveStatus.textContent = "";
    saveStatus.className = "status-msg";

    if (slug) {
      editorTitle.textContent = "Edit Client";
      clientSlugInput.readOnly = true;
      btnDelete.classList.remove("hidden");
      loadClientData(slug);
    } else {
      editorTitle.textContent = "New Client";
      clientSlugInput.readOnly = false;
      btnDelete.classList.add("hidden");
    }
  }

  // ── Client list ──
  async function loadClients() {
    clientListEl.innerHTML = '<p class="loading">Loading clients...</p>';
    try {
      const items = await githubGet("clients");
      const slugs = items.filter((i) => i.type === "dir").map((i) => i.name);
      const results = await Promise.allSettled(
        slugs.map(async (slug) => {
          try {
            const configData = await githubGet(`clients/${slug}/config.json`);
            const config = JSON.parse(atob(configData.content));
            return { slug, name: config.name || slug };
          } catch {
            return { slug, name: slug };
          }
        })
      );
      clients = results.map((r) => (r.status === "fulfilled" ? r.value : { slug: r.reason, name: r.reason }));
      renderClientList();
    } catch (err) {
      console.error(err);
      clientListEl.innerHTML =
        '<p class="empty-state">Failed to load clients. Check your GitHub token and repo.</p>';
    }
  }

  function renderClientList() {
    if (clients.length === 0) {
      clientListEl.innerHTML =
        '<p class="empty-state">No clients yet. Click "Add Client" to get started.</p>';
      return;
    }
    clientListEl.innerHTML = clients
      .map(
        ({ slug, name }) => `
      <div class="client-card" data-slug="${slug}">
        <div class="client-card-preview-wrap">
          <img
            class="client-card-preview"
            src="/image/${encodeURIComponent(slug)}/Sarah?_t=${Date.now()}"
            alt=""
            loading="lazy"
          >
          <div class="client-card-preview-error">No preview</div>
        </div>
        <div class="client-card-footer">
          <div class="client-card-info">
            <span class="client-card-name">${name}</span>
            <span class="client-card-url">/image/${slug}/{name}</span>
          </div>
          <div class="client-card-actions">
            <button class="btn btn-secondary btn-sm client-card-copy" data-url="${location.origin}/image/${slug}/{name}" title="Copy link">Copy link</button>
            <button class="btn btn-danger btn-sm client-card-delete" data-slug="${slug}">Delete</button>
          </div>
        </div>
      </div>
    `
      )
      .join("");

    clientListEl.querySelectorAll(".client-card-preview").forEach((img) => {
      img.addEventListener("error", () => {
        img.style.display = "none";
        img.nextElementSibling.style.display = "flex";
      });
    });

    clientListEl.querySelectorAll(".client-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".client-card-actions")) return;
        showEditor(card.dataset.slug);
      });
    });

    clientListEl.querySelectorAll(".client-card-copy").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.url).then(() => {
          const orig = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => { btn.textContent = orig; }, 1500);
        });
      });
    });

    clientListEl.querySelectorAll(".client-card-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteClient(btn.dataset.slug);
      });
    });
  }

  async function deleteClient(slug) {
    if (!confirm(`Delete client "${slug}"? This cannot be undone.`)) return;
    try {
      await githubDelete(`clients/${slug}/config.json`);
      try { await githubDelete(`clients/${slug}/base.jpg`); } catch {}
      clients = clients.filter((c) => c.slug !== slug);
      if (screenEditor.classList.contains("hidden") === false) {
        showList();
      } else {
        renderClientList();
      }
    } catch (err) {
      alert(`Failed to delete "${slug}": ${err.message}`);
    }
  }

  // ── Load client data into editor ──
  async function loadClientData(slug) {
    try {
      const configData = await githubGet(`clients/${slug}/config.json`);
      const config = JSON.parse(atob(configData.content));

      clientNameInput.value = config.name || "";
      clientSlugInput.value = slug;
      box.x = config.box?.x || 0;
      box.y = config.box?.y || 0;
      box.width = config.box?.width || 0;
      box.height = config.box?.height || 0;
      syncBoxInputs();

      angle = config.angle || 0;
      textAngleInput.value = angle;

      bg.enabled = config.bg?.enabled || false;
      bg.padding = config.bg?.padding ?? 8;
      bgEnabled.checked = bg.enabled;
      bgOptions.classList.toggle("hidden", !bg.enabled);
      bgPaddingInput.value = bg.padding;

      // Load base image via authenticated API (works for private repos)
      try {
        const imageData = await githubGet(`clients/${slug}/base.jpg`);
        const img = new Image();
        img.onload = () => {
          baseImageEl = img;
          drawCanvas();
        };
        img.src = `data:image/jpeg;base64,${imageData.content}`;
      } catch (imgErr) {
        console.warn("Could not load base image:", imgErr);
      }

      uploadArea.classList.add("has-file");
      uploadLabel.textContent = "base.jpg loaded from GitHub";
    } catch (err) {
      console.error("Failed to load client data:", err);
      setStatus("Failed to load client data", "error");
    }
  }

  // ── Form helpers ──
  function resetForm() {
    clientNameInput.value = "";
    clientSlugInput.value = "";
    box = { x: 0, y: 0, width: 0, height: 0 };
    syncBoxInputs();
    angle = 0;
    textAngleInput.value = 0;
    bg = { enabled: false, padding: 8 };
    bgEnabled.checked = false;
    bgOptions.classList.add("hidden");
    bgPaddingInput.value = 8;
    baseImageFile = null;
    baseImageEl = null;
    uploadArea.classList.remove("has-file");
    uploadLabel.textContent = "Click or drag to upload base.jpg";
    clearCanvas();
  }

  function syncBoxInputs() {
    boxX.value = Math.round(box.x);
    boxY.value = Math.round(box.y);
    boxW.value = Math.round(box.width);
    boxH.value = Math.round(box.height);
  }

  function readBoxInputs() {
    box.x = parseInt(boxX.value) || 0;
    box.y = parseInt(boxY.value) || 0;
    box.width = parseInt(boxW.value) || 0;
    box.height = parseInt(boxH.value) || 0;
  }

  function setStatus(msg, type) {
    saveStatus.textContent = msg;
    saveStatus.className = `status-msg ${type}`;
  }

  // ── Canvas drawing ──
  function clearCanvas() {
    const ctx = previewCanvas.getContext("2d");
    previewCanvas.width = 600;
    previewCanvas.height = 400;
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = "#ccc";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Upload an image to preview", 300, 200);
  }

  function drawCanvas() {
    if (!baseImageEl) return;
    const ctx = previewCanvas.getContext("2d");
    previewCanvas.width = baseImageEl.naturalWidth;
    previewCanvas.height = baseImageEl.naturalHeight;
    ctx.drawImage(baseImageEl, 0, 0);

    if (box.width > 0 && box.height > 0) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const lw = Math.max(2, Math.round(baseImageEl.naturalWidth / 500));

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((angle * Math.PI) / 180);

      // Background preview
      if (bg.enabled) {
        ctx.globalAlpha = bg.opacity;
        ctx.fillStyle = bg.color;
        ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
        ctx.globalAlpha = 1;
      }

      // Dashed outline
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = lw;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height);
      ctx.setLineDash([]);

      // Blue tint fill
      ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
      ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);

      // Center dot
      const r = Math.max(4, Math.round(baseImageEl.naturalWidth / 300));
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(37, 99, 235, 0.4)";
      ctx.fill();

      ctx.restore();
    }
  }

  // ── Canvas mouse events for bounding box drawing ──
  function getCanvasCoords(e) {
    const rect = previewCanvas.getBoundingClientRect();
    const scaleX = previewCanvas.width / rect.width;
    const scaleY = previewCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  previewCanvas.addEventListener("mousedown", (e) => {
    if (!baseImageEl) return;
    isDrawing = true;
    drawStart = getCanvasCoords(e);
  });

  previewCanvas.addEventListener("mousemove", (e) => {
    if (!isDrawing || !baseImageEl) return;
    const pos = getCanvasCoords(e);
    box.x = Math.min(drawStart.x, pos.x);
    box.y = Math.min(drawStart.y, pos.y);
    box.width = Math.abs(pos.x - drawStart.x);
    box.height = Math.abs(pos.y - drawStart.y);
    syncBoxInputs();
    drawCanvas();
  });

  previewCanvas.addEventListener("mouseup", () => {
    isDrawing = false;
  });

  previewCanvas.addEventListener("mouseleave", () => {
    isDrawing = false;
  });

  // Touch support
  previewCanvas.addEventListener("touchstart", (e) => {
    if (!baseImageEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    isDrawing = true;
    drawStart = getCanvasCoords(touch);
  });

  previewCanvas.addEventListener("touchmove", (e) => {
    if (!isDrawing || !baseImageEl) return;
    e.preventDefault();
    const touch = e.touches[0];
    const pos = getCanvasCoords(touch);
    box.x = Math.min(drawStart.x, pos.x);
    box.y = Math.min(drawStart.y, pos.y);
    box.width = Math.abs(pos.x - drawStart.x);
    box.height = Math.abs(pos.y - drawStart.y);
    syncBoxInputs();
    drawCanvas();
  });

  previewCanvas.addEventListener("touchend", () => {
    isDrawing = false;
  });

  // ── Box input changes → redraw ──
  [boxX, boxY, boxW, boxH].forEach((input) => {
    input.addEventListener("input", () => {
      readBoxInputs();
      drawCanvas();
    });
  });

  // ── File upload ──
  uploadArea.addEventListener("click", () => fileInput.click());

  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("drag-over");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) handleFile(file);
  });

  function handleFile(file) {
    if (!file.type.match(/image\/(jpeg|png)/)) {
      setStatus("Only JPEG and PNG images are supported", "error");
      return;
    }
    baseImageFile = file;
    uploadArea.classList.add("has-file");
    uploadLabel.textContent = file.name;

    const img = new Image();
    img.onload = () => {
      baseImageEl = img;
      drawCanvas();
    };
    img.src = URL.createObjectURL(file);
  }

  // ── Rotation ──
  textAngleInput.addEventListener("input", () => {
    angle = parseInt(textAngleInput.value) || 0;
    drawCanvas();
  });

  // ── Background controls ──
  bgEnabled.addEventListener("change", () => {
    bg.enabled = bgEnabled.checked;
    bgOptions.classList.toggle("hidden", !bg.enabled);
    drawCanvas();
  });

  bgPaddingInput.addEventListener("input", () => {
    bg.padding = parseInt(bgPaddingInput.value) || 0;
  });

  // ── Save ──
  btnSave.addEventListener("click", async () => {
    const slug = clientSlugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!slug) {
      setStatus("Slug is required", "error");
      return;
    }
    if (!baseImageFile && !baseImageEl) {
      setStatus("Base image is required", "error");
      return;
    }

    btnSave.disabled = true;
    setStatus("Saving...", "");

    try {
      // Build config
      readBoxInputs();
      const config = {
        name: clientNameInput.value.trim() || slug,
        box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        font: "Indie Flower",
        align: "center",
        angle: parseInt(textAngleInput.value) || 0,
        bg: {
          enabled: bgEnabled.checked,
          padding: parseInt(bgPaddingInput.value) || 0,
        },
      };

      // Write config.json
      await githubPut(
        `clients/${slug}/config.json`,
        JSON.stringify(config, null, 2)
      );

      // Write base.jpg if a new file was uploaded
      if (baseImageFile) {
        const base64 = await fileToBase64(baseImageFile);
        await githubPut(`clients/${slug}/base.jpg`, base64, true);
      }

      setStatus("Saved successfully!", "success");

      // If it was a new client, add to list and make slug read-only
      if (!editingSlug) {
        clients.push({ slug, name: config.name });
        editingSlug = slug;
        clientSlugInput.readOnly = true;
        btnDelete.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Save error:", err);
      setStatus(`Save failed: ${err.message}`, "error");
    } finally {
      btnSave.disabled = false;
    }
  });

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Remove data URL prefix, keep only base64
        resolve(reader.result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Preview ──
  btnPreview.addEventListener("click", () => {
    const slug = clientSlugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!slug) {
      setStatus("Enter a slug to preview", "error");
      return;
    }
    previewModal.classList.remove("hidden");
    loadPreview(slug);
  });

  previewNameInput.addEventListener("input", () => {
    const slug = clientSlugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    loadPreview(slug);
  });

  async function loadPreview(slug) {
    const name = previewNameInput.value.trim() || "Test";
    const previewUrl = `/image/${encodeURIComponent(slug)}/${encodeURIComponent(name)}?_t=${Date.now()}`;
    previewImage.src = "";
    previewImage.alt = "";
    previewStatus.textContent = "Loading...";
    previewStatus.className = "preview-status";

    try {
      const res = await fetch(previewUrl);
      if (!res.ok) {
        const body = await res.text();
        previewStatus.textContent = `Error ${res.status}: ${body}`;
        previewStatus.className = "preview-status error";
        return;
      }
      const blob = await res.blob();
      previewImage.src = URL.createObjectURL(blob);
      previewStatus.textContent = "";
    } catch (err) {
      previewStatus.textContent = `Network error: ${err.message}`;
      previewStatus.className = "preview-status error";
    }
  }

  btnCloseModal.addEventListener("click", () => {
    previewModal.classList.add("hidden");
  });

  previewModal.querySelector(".modal-backdrop").addEventListener("click", () => {
    previewModal.classList.add("hidden");
  });

  // ── Delete from editor ──
  btnDelete.addEventListener("click", () => {
    if (editingSlug) deleteClient(editingSlug);
  });

  // ── Navigation events ──
  btnAddClient.addEventListener("click", () => showEditor(null));
  btnBack.addEventListener("click", showList);

  // ── Init ──
  clearCanvas();
  (async () => {
    try {
      const res = await fetch("/.netlify/functions/config");
      if (res.status === 401) { window.location.href = "/"; return; }
      if (!res.ok) throw new Error(await res.text());
      const { token, repo } = await res.json();
      GITHUB_API = `https://api.github.com/repos/${repo}/contents`;
      headers.Authorization = `Bearer ${token}`;
    } catch (err) {
      clientListEl.innerHTML = `<p class="empty-state">Failed to load config: ${err.message}</p>`;
      return;
    }
    loadClients();
  })();
})();