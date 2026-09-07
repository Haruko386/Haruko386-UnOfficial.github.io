(function () {
  "use strict";

  var app;
  var selectedId = null;
  var picking = false;
  var apiReady = false;
  var editorListCollapsed = false;
  var MAX_IMAGE_EDGE = 1920;
  var WEBP_QUALITY = 0.82;
  var DEFAULT_POI_COLOR = "#f0c86d";
  var POI_COLORS = ["#f0c86d", "#79c6a3", "#e78473", "#7aa7e8", "#c58bd1", "#ed9f57"];

  function el(id) { return document.getElementById(id); }
  function current() { return app && app.find(selectedId); }

  function setStatus(message, isError) {
    var status = el("editor-status");
    status.textContent = message;
    status.style.color = isError ? "#9b3e34" : "";
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "poi-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function renderEditorList() {
    var list = el("editor-list");
    list.replaceChildren();
    app.state.config.points.forEach(function (poi) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "editor-list-item" + (poi.id === selectedId ? " is-active" : "");
      button.style.setProperty("--poi-color", poi.color || DEFAULT_POI_COLOR);
      var title = document.createElement("strong");
      title.textContent = poi.title || "未命名建筑";
      var coordinates = document.createElement("span");
      coordinates.textContent = "X " + poi.x + " · Z " + poi.z;
      button.append(title, coordinates);
      button.addEventListener("click", function () {
        selectPoi(poi.id, true);
        setEditorListCollapsed(true);
        el("editor-panel").scrollTo({ top: 0, behavior: "smooth" });
      });
      list.appendChild(button);
    });
    updateListToggle();
  }

  function updateListToggle() {
    var button = el("toggle-editor-list");
    var list = el("editor-list");
    list.classList.toggle("is-collapsed", editorListCollapsed);
    button.setAttribute("aria-expanded", String(!editorListCollapsed));
    button.textContent = editorListCollapsed
      ? "展开 (" + app.state.config.points.length + ")"
      : "收起";
  }

  function setEditorListCollapsed(collapsed) {
    editorListCollapsed = collapsed;
    updateListToggle();
  }

  function renderImages() {
    var container = el("image-list");
    var poi = current();
    container.replaceChildren();
    (poi && poi.images || []).forEach(function (item, index) {
      var row = document.createElement("div");
      row.className = "image-editor-row";
      var image = document.createElement("img");
      image.src = item.src;
      image.alt = "";
      var name = document.createElement("span");
      name.textContent = item.caption || item.src.split("/").pop();
      var remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "移除";
      remove.addEventListener("click", function () {
        poi.images.splice(index, 1);
        renderImages();
      });
      row.append(image, name, remove);
      container.appendChild(row);
    });
  }

  function selectPoi(id, center) {
    var poi = app.find(id);
    if (!poi) return;
    selectedId = id;
    var form = el("poi-form");
    form.hidden = false;
    el("editor-empty").hidden = true;
    form.elements.title.value = poi.title || "";
    form.elements.x.value = poi.x;
    form.elements.z.value = poi.z;
    form.elements.summary.value = poi.summary || "";
    form.elements.description.value = poi.description || "";
    form.elements.color.value = poi.color || DEFAULT_POI_COLOR;
    form.elements.tags.value = (poi.tags || []).join(", ");
    form.elements.builtAt.value = poi.builtAt || "";
    renderImages();
    renderEditorList();
    if (center) app.state.unmined.center([Number(poi.x), Number(poi.z)]);
  }

  function applyForm() {
    var poi = current();
    if (!poi) return true;
    var form = el("poi-form");
    if (!form.reportValidity()) return false;
    poi.title = form.elements.title.value.trim();
    poi.x = Math.round(Number(form.elements.x.value));
    poi.z = Math.round(Number(form.elements.z.value));
    poi.summary = form.elements.summary.value.trim();
    poi.description = form.elements.description.value.trim();
    poi.color = form.elements.color.value || DEFAULT_POI_COLOR;
    poi.tags = form.elements.tags.value.split(",").map(function (tag) { return tag.trim(); }).filter(Boolean);
    poi.builtAt = form.elements.builtAt.value.trim();
    app.rebuild();
    renderEditorList();
    setStatus("有尚未保存的修改");
    return true;
  }

  function startPicking() {
    if (!current()) return;
    picking = true;
    el("pick-banner").hidden = false;
    app.state.unmined.olMap.getTargetElement().style.cursor = "crosshair";
  }

  function stopPicking() {
    picking = false;
    el("pick-banner").hidden = true;
    app.state.unmined.olMap.getTargetElement().style.cursor = "";
  }

  function addPoi() {
    var center = ol.proj.transform(
      app.state.unmined.olMap.getView().getCenter(),
      app.state.unmined.viewProjection,
      app.state.unmined.dataProjection
    );
    var poi = {
      id: makeId(), title: "新建筑", x: Math.round(center[0]), z: Math.round(center[1]),
      summary: "", description: "", color: POI_COLORS[app.state.config.points.length % POI_COLORS.length],
      tags: [], builtAt: "", images: []
    };
    app.state.config.points.push(poi);
    app.rebuild();
    selectPoi(poi.id, false);
    setEditorListCollapsed(true);
    el("editor-panel").scrollTop = 0;
    el("poi-form").elements.title.select();
    startPicking();
  }

  function saveAll() {
    if (!apiReady) {
      setStatus("无法保存：请通过本地编辑器脚本打开页面", true);
      return;
    }
    if (!applyForm()) return;
    var buttons = [el("save-all"), el("save-current")];
    buttons.forEach(function (button) { if (button) button.disabled = true; });
    setStatus("正在保存…");
    fetch("../api/pois", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(app.state.config, null, 2)
    }).then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).then(function () {
      setStatus("已保存，可以提交到 GitHub");
      buttons.forEach(function (button) {
        if (!button) return;
        button.disabled = false;
        var original = button.id === "save-current" ? "保存修改" : "保存全部";
        button.textContent = "已保存 ✓";
        window.setTimeout(function () { button.textContent = original; }, 1400);
      });
    }).catch(function (error) {
      console.error(error);
      setStatus("保存失败，请确认本地编辑器仍在运行", true);
      buttons.forEach(function (button) { if (button) button.disabled = false; });
    });
  }

  function fileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function canvasAsWebp(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("当前浏览器无法生成 WebP 图片"));
      }, "image/webp", WEBP_QUALITY);
    });
  }

  async function optimizeImage(file) {
    var bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    var width = Math.max(1, Math.round(bitmap.width * scale));
    var height = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var context = canvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    var blob = await canvasAsWebp(canvas);
    return {
      blob: blob,
      filename: file.name.replace(/\.[^.]+$/, "") + ".webp",
      originalSize: file.size,
      width: width,
      height: height
    };
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  async function uploadImages(files) {
    var poi = current();
    if (!poi || !apiReady || !files.length) return;
    setStatus("正在压缩截图…");
    var originalTotal = 0;
    var optimizedTotal = 0;
    for (var i = 0; i < files.length; i += 1) {
      var file = files[i];
      var optimized = await optimizeImage(file);
      originalTotal += optimized.originalSize;
      optimizedTotal += optimized.blob.size;
      setStatus("正在上传 " + (i + 1) + "/" + files.length + "…");
      var response = await fetch("../api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poiId: poi.id,
          filename: optimized.filename,
          data: await fileAsDataUrl(optimized.blob)
        })
      });
      if (!response.ok) throw new Error("上传失败：HTTP " + response.status);
      var result = await response.json();
      poi.images.push({ src: result.path, alt: poi.title + "的截图", caption: "" });
    }
    renderImages();
    setStatus("截图已压缩：" + formatSize(originalTotal) + " → " + formatSize(optimizedTotal) + "，记得保存修改");
    el("image-upload").value = "";
  }

  function bindEditor() {
    el("add-poi").addEventListener("click", addPoi);
    el("toggle-editor-list").addEventListener("click", function () {
      setEditorListCollapsed(!editorListCollapsed);
    });
    el("save-all").addEventListener("click", saveAll);
    el("pick-position").addEventListener("click", startPicking);
    el("cancel-pick").addEventListener("click", stopPicking);
    el("poi-form").addEventListener("submit", function (event) {
      event.preventDefault();
      saveAll();
    });
    el("delete-poi").addEventListener("click", function () {
      var poi = current();
      if (!poi || !window.confirm("确定删除“" + poi.title + "”吗？保存前仍可刷新页面撤销。")) return;
      app.state.config.points = app.state.config.points.filter(function (item) { return item.id !== poi.id; });
      selectedId = null;
      el("poi-form").hidden = true;
      el("editor-empty").hidden = false;
      app.rebuild();
      renderEditorList();
      setStatus("兴趣点已移除，记得保存全部");
    });
    el("image-upload").addEventListener("change", function (event) {
      uploadImages(Array.from(event.target.files)).catch(function (error) {
        console.error(error);
        setStatus(error.message, true);
      });
    });
    app.state.unmined.olMap.on("singleclick", function (event) {
      if (!picking || !current()) return;
      var coordinate = ol.proj.transform(event.coordinate, app.state.unmined.viewProjection, app.state.unmined.dataProjection);
      el("poi-form").elements.x.value = Math.round(coordinate[0]);
      el("poi-form").elements.z.value = Math.round(coordinate[1]);
      applyForm();
      stopPicking();
    });
    editorListCollapsed = app.state.config.points.length > 12;
    renderEditorList();

    fetch("../api/health", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error();
      apiReady = true;
      setStatus("本地编辑服务已连接");
    }).catch(function () {
      apiReady = false;
      setStatus("当前是只读模式；请运行 tools/start-poi-editor.ps1", true);
      el("save-all").disabled = true;
      el("image-upload").disabled = true;
    });
  }

  document.addEventListener("poimapready", function (event) {
    app = event.detail;
    bindEditor();
  });
})();
