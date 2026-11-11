const form = document.getElementById("form");
const layoutsEl = document.getElementById("layouts");
const foundEl = document.getElementById("found");
const statusEl = document.getElementById("status");
const tabsEl = document.getElementById("tabs");
const frame = document.getElementById("frame");
const filesPanel = document.getElementById("filesPanel");
const filesList = document.getElementById("filesList");

let pairCount = 0;

function setStatus(message, kind = "") {
  statusEl.className = `status ${kind}`;
  statusEl.textContent = message;
}

function commonValues() {
  const data = new FormData(form);
  return {
    outputName: data.get("outputName").trim(),
    folder: data.get("folder").trim(),
    from: data.get("from").trim(),
    to: data.get("to").trim(),
    cc: data.get("cc").trim(),
  };
}

function rebuildLayouts() {
  if (!pairCount) {
    layoutsEl.className = "empty-hint";
    layoutsEl.textContent = "Upload images to add a subject for each pair.";
    return;
  }
    layoutsEl.className = "row-2";
  layoutsEl.innerHTML = Array.from({ length: pairCount }, (_, i) => {
    const n = i + 1;
    return `
      <div class="layout" data-pair="${n}">
        <h3>Pair ${n} · <code>m${n}</code> + <code>d${n}</code></h3>
        <label>Subject <input class="subject" required placeholder="Email subject"></label>
      </div>`;
  }).join("");
}

function collectLayouts() {
  const common = commonValues();
  const layouts = [];
  [...layoutsEl.querySelectorAll(".layout")].forEach((node) => {
    const n = node.dataset.pair;
    const subject = node.querySelector(".subject").value.trim();
    layouts.push({
      viewType: "mobile",
      imageStem: `m${n}`,
      from: common.from,
      to: common.to,
      cc: common.cc,
      subject,
    });
    layouts.push({
      viewType: "desktop",
      imageStem: `d${n}`,
      from: common.from,
      to: common.to,
      cc: common.cc,
      subject,
    });
  });
  return layouts;
}

function previewUrl(layout) {
  const common = commonValues();
  const query = new URLSearchParams({
    folder: common.folder,
    viewType: layout.viewType,
    stem: layout.imageStem,
    from: layout.from,
    to: layout.to,
    cc: layout.cc,
    subject: layout.subject,
  });
  return `/preview?${query}`;
}

function showPreview(index = 0) {
  const layouts = collectLayouts();
  tabsEl.innerHTML = "";
  if (!layouts.length || !commonValues().folder) {
    frame.removeAttribute("src");
    return;
  }
  layouts.forEach((layout, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${layout.viewType} · ${layout.imageStem}`;
    btn.className = i === index ? "active" : "";
    btn.addEventListener("click", () => showPreview(i));
    tabsEl.append(btn);
  });
  frame.src = previewUrl(layouts[index]);
}

document.getElementById("folderUpload").addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  const body = new FormData();
  files.forEach((file) => body.append("files", file, file.name));
  setStatus("Uploading screenshots…");
  const res = await fetch("/api/upload-screenshots", { method: "POST", body });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error, "error");
    return;
  }
  form.folder.value = data.folder;
  pairCount = data.pairCount || 0;
  foundEl.textContent = data.items?.length
    ? `${data.total} files · ${data.pairCount} pairs (${data.mobile} mobile, ${data.desktop} desktop)`
    : "No m/d images found in that folder.";
  rebuildLayouts();
  setStatus(`Uploaded ${data.pairCount} pairs`, "ok");
  showPreview(0);
});

document.getElementById("previewBtn").addEventListener("click", () => {
  if (!commonValues().folder) {
    setStatus("Upload a screenshot folder first.", "error");
    return;
  }
  showPreview(0);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const common = commonValues();
  if (!common.folder) {
    setStatus("Upload a screenshot folder first.", "error");
    return;
  }
  const missing = collectLayouts().find((row) => !row.subject);
  if (missing) {
    setStatus("Enter a subject for every pair.", "error");
    return;
  }
  setStatus("Generating PDFs… this can take a moment for large screenshots.");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...common,
        layouts: collectLayouts(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setStatus(`Saved ${data.merged}`, "ok");
    const link = document.createElement("a");
    link.href = data.download;
    link.textContent = " Open merged PDF";
    statusEl.append(link);
    showPreview(0);
    loadOutputs();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

async function loadOutputs() {
  const res = await fetch("/api/outputs");
  const data = await res.json();
  if (!res.ok) {
    filesList.textContent = data.error || "Could not list files.";
    return;
  }
  if (!data.items.length) {
    filesList.innerHTML = `<p class="empty-hint">No generated PDFs yet.</p>`;
    return;
  }
  filesList.innerHTML = data.items
    .map(
      (item) => `
      <div class="file-row" data-name="${item.name}">
        <div>
          <strong>${item.name}</strong>
          <span>${item.size} · ${item.modified}</span>
        </div>
        <a href="${item.download}" target="_blank"><button type="button" class="secondary small">Open</button></a>
        <button type="button" class="danger small delete-one">Delete</button>
      </div>`,
    )
    .join("");
  filesList.querySelectorAll(".delete-one").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.closest(".file-row").dataset.name;
      if (!confirm(`Delete ${name}?`)) return;
      await fetch(`/api/outputs/${encodeURIComponent(name)}`, { method: "DELETE" });
      loadOutputs();
    });
  });
}

document.getElementById("filesBtn").addEventListener("click", () => {
  filesPanel.classList.toggle("hidden");
  if (!filesPanel.classList.contains("hidden")) loadOutputs();
});

document.getElementById("deleteAllBtn").addEventListener("click", async () => {
  if (!confirm("Delete all generated PDFs and uploads?")) return;
  await fetch("/api/outputs", { method: "DELETE" });
  loadOutputs();
});
