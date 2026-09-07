(function () {
  "use strict";

  var state = {
    config: { version: 1, site: {}, points: [] },
    unmined: null,
    layer: null,
    activePoi: null,
    galleryIndex: 0,
    overviewZoom: null,
    overviewPoiIds: new Set()
  };
  var DEFAULT_POI_COLOR = "#f0c86d";
  var OVERVIEW_MIN_SPACING_PX = 150;

  function el(id) { return document.getElementById(id); }

  function finishLoading(message) {
    var loading = el("loading");
    if (!loading) return;
    if (message) loading.textContent = message;
    else {
      loading.classList.add("is-done");
      window.setTimeout(function () { loading.hidden = true; }, 320);
    }
  }

  function markerStyle(feature, resolution) {
    var zoom = state.unmined ? state.unmined.olMap.getView().getZoom() : Infinity;
    if (zoom <= state.overviewZoom + 0.05 && !state.overviewPoiIds.has(feature.get("poiId"))) return null;
    var label = feature.get("title");
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 10,
        fill: new ol.style.Fill({ color: feature.get("color") || DEFAULT_POI_COLOR }),
        stroke: new ol.style.Stroke({ color: "#253b2d", width: 4 })
      }),
      text: new ol.style.Text({
        text: label,
        font: "600 13px system-ui, sans-serif",
        offsetY: 24,
        padding: [4, 7, 4, 7],
        fill: new ol.style.Fill({ color: "#fffdf5" }),
        backgroundFill: new ol.style.Fill({ color: "rgba(26, 42, 32, .82)" })
      })
    });
  }

  function poiTextLength(poi) {
    return Array.from(((poi.description || "") + " " + (poi.summary || "")).trim()).length;
  }

  function updateOverviewSelection() {
    if (!state.unmined) return;
    var view = state.unmined.olMap.getView();
    var resolution = view.getResolution() || 1;
    var minimumDistance = resolution * OVERVIEW_MIN_SPACING_PX;
    var minimumDistanceSquared = minimumDistance * minimumDistance;
    var selected = [];

    state.config.points.slice().sort(function (a, b) {
      return poiTextLength(b) - poiTextLength(a) || String(a.title).localeCompare(String(b.title), "zh-CN");
    }).forEach(function (poi) {
      var coordinate = ol.proj.transform(
        [Number(poi.x), Number(poi.z)],
        state.unmined.dataProjection,
        state.unmined.viewProjection
      );
      var hasNearbyRepresentative = selected.some(function (item) {
        var dx = coordinate[0] - item.coordinate[0];
        var dy = coordinate[1] - item.coordinate[1];
        return dx * dx + dy * dy < minimumDistanceSquared;
      });
      if (!hasNearbyRepresentative) selected.push({ id: poi.id, coordinate: coordinate });
    });

    state.overviewPoiIds = new Set(selected.map(function (item) { return item.id; }));
    if (state.layer) state.layer.changed();
  }

  function buildPoiLayer() {
    if (state.layer) state.unmined.olMap.removeLayer(state.layer);
    updateOverviewSelection();
    var features = state.config.points.map(function (poi) {
      var feature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.transform(
          [Number(poi.x), Number(poi.z)],
          state.unmined.dataProjection,
          state.unmined.viewProjection
        )),
        poiId: poi.id,
        title: poi.title,
        color: poi.color || DEFAULT_POI_COLOR
      });
      feature.setStyle(markerStyle);
      return feature;
    });
    state.layer = new ol.layer.Vector({
      source: new ol.source.Vector({ features: features }),
      zIndex: 100
    });
    state.layer.set("isPoiLayer", true);
    state.unmined.olMap.addLayer(state.layer);
  }

  function findPoi(id) {
    return state.config.points.find(function (poi) { return poi.id === id; });
  }

  function setText(target, text) {
    target.textContent = text || "";
    target.hidden = !text;
  }

  function renderGallery() {
    var gallery = el("poi-gallery");
    if (!gallery || !state.activePoi) return;
    gallery.replaceChildren();
    var images = Array.isArray(state.activePoi.images) ? state.activePoi.images : [];
    if (!images.length) {
      var empty = document.createElement("div");
      empty.className = "gallery-empty";
      empty.textContent = "这座建筑还没有上传截图";
      gallery.appendChild(empty);
      return;
    }

    state.galleryIndex = (state.galleryIndex + images.length) % images.length;
    var current = images[state.galleryIndex];
    var image = document.createElement("img");
    image.className = "gallery-main";
    image.src = current.src;
    image.alt = current.alt || state.activePoi.title + "的截图";
    gallery.appendChild(image);

    var controls = document.createElement("div");
    controls.className = "gallery-controls";
    var caption = document.createElement("span");
    caption.className = "gallery-caption";
    caption.textContent = (current.caption || state.activePoi.title) + " · " + (state.galleryIndex + 1) + "/" + images.length;
    controls.appendChild(caption);
    if (images.length > 1) {
      var nav = document.createElement("div");
      nav.className = "gallery-nav";
      [["上一张", "←", -1], ["下一张", "→", 1]].forEach(function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", item[0]);
        button.textContent = item[1];
        button.addEventListener("click", function () {
          state.galleryIndex += item[2];
          renderGallery();
        });
        nav.appendChild(button);
      });
      controls.appendChild(nav);
    }
    gallery.appendChild(controls);
  }

  function updateUrl(id) {
    if (document.body.dataset.mode !== "viewer") return;
    var url = new URL(window.location.href);
    if (id) url.searchParams.set("poi", id);
    else url.searchParams.delete("poi");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function openPoi(poi, center) {
    var backdrop = el("poi-backdrop");
    if (!poi || !backdrop) return;
    state.activePoi = poi;
    state.galleryIndex = 0;
    setText(el("poi-title"), poi.title);
    setText(el("poi-summary"), poi.summary);
    setText(el("poi-description"), poi.description);
    var meta = ["X " + poi.x + " · Z " + poi.z];
    if (poi.builtAt) meta.push(poi.builtAt);
    setText(el("poi-meta"), meta.join("  /  "));
    var tags = el("poi-tags");
    tags.replaceChildren();
    (poi.tags || []).forEach(function (tag) {
      var chip = document.createElement("span");
      chip.textContent = tag;
      tags.appendChild(chip);
    });
    tags.hidden = !(poi.tags || []).length;
    renderGallery();
    if (center) state.unmined.center([Number(poi.x), Number(poi.z)]);
    closeList();
    backdrop.hidden = false;
    document.body.classList.add("modal-open");
    window.requestAnimationFrame(function () { backdrop.classList.add("is-open"); });
    updateUrl(poi.id);
    el("dialog-close").focus();
  }

  function closePoi() {
    var backdrop = el("poi-backdrop");
    if (!backdrop || backdrop.hidden) return;
    backdrop.classList.remove("is-open");
    document.body.classList.remove("modal-open");
    state.activePoi = null;
    updateUrl(null);
    window.setTimeout(function () { backdrop.hidden = true; }, 250);
  }

  function closeList() {
    var list = el("poi-list");
    if (!list) return;
    list.classList.remove("is-open");
    list.setAttribute("aria-hidden", "true");
  }

  function renderList() {
    var container = el("poi-list-content");
    if (!container) return;
    container.replaceChildren();
    if (!state.config.points.length) {
      var empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "这里还没有兴趣点。运行本地编辑器，为第一座建筑写下故事吧。";
      container.appendChild(empty);
      return;
    }
    state.config.points.forEach(function (poi) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "poi-list-item";
      button.style.setProperty("--poi-color", poi.color || DEFAULT_POI_COLOR);
      var title = document.createElement("strong");
      title.textContent = poi.title;
      var summary = document.createElement("span");
      summary.textContent = poi.summary || "X " + poi.x + " · Z " + poi.z;
      button.append(title, summary);
      button.addEventListener("click", function () { openPoi(poi, true); });
      container.appendChild(button);
    });
  }

  function setupViewer() {
    if (document.body.dataset.mode !== "viewer") return;
    document.title = "My World";
    renderList();

    el("open-list").addEventListener("click", function () {
      el("poi-list").classList.add("is-open");
      el("poi-list").setAttribute("aria-hidden", "false");
    });
    document.querySelector(".close-list").addEventListener("click", closeList);
    el("dialog-close").addEventListener("click", closePoi);
    el("poi-backdrop").addEventListener("click", function (event) {
      if (event.target === event.currentTarget) closePoi();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { closePoi(); closeList(); }
    });

    state.unmined.olMap.on("singleclick", function (event) {
      var hit = state.unmined.olMap.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
        return layer === state.layer ? feature : null;
      }, { hitTolerance: 8 });
      if (hit) openPoi(findPoi(hit.get("poiId")), false);
    });
    state.unmined.olMap.on("pointermove", function (event) {
      var hit = state.unmined.olMap.hasFeatureAtPixel(event.pixel, {
        layerFilter: function (layer) { return layer === state.layer; }, hitTolerance: 6
      });
      state.unmined.olMap.getTargetElement().style.cursor = hit ? "pointer" : "";
    });

    var initialId = new URL(window.location.href).searchParams.get("poi");
    if (initialId) openPoi(findPoi(initialId), true);
  }

  function normalizeConfig(config) {
    config = config && typeof config === "object" ? config : {};
    config.version = 1;
    config.site = config.site && typeof config.site === "object" ? config.site : {};
    config.points = Array.isArray(config.points) ? config.points.filter(function (poi) {
      return poi && poi.id && poi.title && Number.isFinite(Number(poi.x)) && Number.isFinite(Number(poi.z));
    }) : [];
    return config;
  }

  function boot(config) {
    state.config = normalizeConfig(config);
    if (typeof UnminedPlayers !== "undefined" && UnminedPlayers.length) {
      UnminedMapProperties.playerMarkers = Unmined.createPlayerMarkers(UnminedPlayers);
    }
    state.unmined = new Unmined(el("map"), UnminedMapProperties, UnminedRegions);
    state.overviewZoom = state.unmined.olMap.getView().getZoom();
    buildPoiLayer();
    state.unmined.olMap.getView().on("change:resolution", function () {
      updateOverviewSelection();
    });
    setupViewer();
    window.PoiMap = {
      state: state,
      rebuild: buildPoiLayer,
      find: findPoi
    };
    finishLoading();
    document.dispatchEvent(new CustomEvent("poimapready", { detail: window.PoiMap }));
  }

  fetch("../map/pois.json", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(boot)
    .catch(function (error) {
      console.error(error);
      finishLoading("无法读取兴趣点数据，请通过本地服务器或网站地址打开此页面。");
    });
})();
