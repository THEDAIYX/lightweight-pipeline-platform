/* global Cesium */
(async () => {
  const els = Object.fromEntries(['errorToast','fps','loadState','loadingScreen','loadingHint','modelState','pendingTiles','quality','qualityValue','selectionPanel','clearSelection','selectedTitle','selectedDetail','selectionPath','propertyList','treeRoot','treeSearch','treeCount','clock'].map((id) => [id, document.querySelector(`#${id}`)]));
  const homeView = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(28), Cesium.Math.toRadians(-28), 90);
  const accent = Cesium.Color.fromCssColorString('#f6bd54');
  const normal = Cesium.Color.WHITE;
  const dimmed = Cesium.Color.fromCssColorString('#6f8794').withAlpha(.16);
  const weldedColor = Cesium.Color.fromCssColorString('#2589ff');
  const pendingColor = Cesium.Color.fromCssColorString('#f08b35');
  let tileset; let modelIndex; let weldStatus = { records: {} }; let modelMatrix; let modelBounds; let selectedId = null; let selectedSphere = null; let wireframe = false; let lightBackground = true; let dimOthers = true; let weldProgressEnabled = false; let hideUnselected = false; let hideSelected = false; let weldStyle;
  const expanded = new Set(); const componentFeatures = new Map(); const seenContents = new WeakSet(); const progressByComponent = new Map(); const weldContextByNodeId = new Map();

  const viewer = new Cesium.Viewer('cesiumContainer', { animation: false, baseLayer: false, baseLayerPicker: false, fullscreenButton: false, geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false, sceneModePicker: false, selectionIndicator: false, timeline: false, vrButton: false, terrainProvider: new Cesium.EllipsoidTerrainProvider() });
  viewer.scene.globe.show = false; viewer.scene.skyBox.show = false; viewer.scene.skyAtmosphere.show = false; viewer.scene.sun.show = false; viewer.scene.moon.show = false; viewer.scene.fog.enabled = false;
  viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(new Cesium.Cartesian3(.55, .45, -.7), new Cesium.Cartesian3()), intensity: 1.7 });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#d5e4e8'); viewer.scene.postProcessStages.fxaa.enabled = true; viewer.scene.highDynamicRange = false; viewer.resolutionScale = 1;
  const cameraController = viewer.scene.screenSpaceCameraController;
  cameraController.enableTranslate = false;
  cameraController.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
  cameraController.zoomEventTypes = [Cesium.CameraEventType.WHEEL];
  let panTarget = null; let panLast = null;
  function panCamera(deltaX, deltaY) {
    if (!panTarget) return;
    const cameraPosition = viewer.camera.positionWC;
    const distance = Cesium.Cartesian3.distance(cameraPosition, panTarget);
    const scale = Math.max(distance, 1) / Math.max(viewer.canvas.clientHeight, 1);
    const horizontal = Cesium.Cartesian3.multiplyByScalar(viewer.camera.rightWC, -deltaX * scale, new Cesium.Cartesian3());
    const vertical = Cesium.Cartesian3.multiplyByScalar(viewer.camera.upWC, deltaY * scale, new Cesium.Cartesian3());
    const offset = Cesium.Cartesian3.add(horizontal, vertical, new Cesium.Cartesian3());
    panTarget = Cesium.Cartesian3.add(panTarget, offset, panTarget);
    viewer.camera.moveRight(-deltaX * scale);
    viewer.camera.moveUp(deltaY * scale);
  }
  viewer.screenSpaceEventHandler.setInputAction((movement) => {
    panTarget = Cesium.Cartesian3.clone((selectedSphere || modelBounds)?.center || viewer.camera.positionWC);
    panLast = Cesium.Cartesian2.clone(movement.position);
    cameraController.enableInputs = false;
  }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
  viewer.screenSpaceEventHandler.setInputAction((movement) => {
    if (!panLast) return;
    const deltaX = movement.endPosition.x - panLast.x;
    const deltaY = movement.endPosition.y - panLast.y;
    panCamera(deltaX, deltaY);
    panLast = Cesium.Cartesian2.clone(movement.endPosition, panLast);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  viewer.screenSpaceEventHandler.setInputAction(() => {
    panTarget = null; panLast = null; cameraController.enableInputs = true;
  }, Cesium.ScreenSpaceEventType.RIGHT_UP);

  const toast = (message) => { els.errorToast.textContent = message; els.errorToast.hidden = false; };
  const label = (key) => key.replace(/^EP3D_/, '').replaceAll('元件1', '元件 1').replaceAll('元件2', '元件 2');
  const weldKey = (pipe, weld) => `${String(pipe || '').replace(/\s+/g, '').toUpperCase()}#${String(weld || '').replace(/\s+/g, '').toUpperCase()}`;
  const node = (id) => modelIndex?.nodes[id];
  function normalizeModelIndex(index) {
    Object.values(index.nodes || {}).forEach((item) => {
      if (Array.isArray(item.bounds) && item.bounds.length >= 6) item.bounds = { min: item.bounds.slice(0, 3), max: item.bounds.slice(3, 6) };
    });
    return index;
  }
  function setLoading(message) { els.loadingHint.textContent = message; }
  function setQuality(value) { if (tileset) tileset.maximumScreenSpaceError = Number(value); els.qualityValue.textContent = value <= 16 ? '精细' : value <= 32 ? '均衡' : '流畅'; }
  function reframe() { if (modelBounds) { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); viewer.camera.viewBoundingSphere(modelBounds, homeView); } }
  function componentIdsFor(id) { const item = node(id); if (!item) return []; return [...item.componentIds, ...item.childIds.flatMap(componentIdsFor)]; }
  function boundsFor(id, current) { const item = node(id); if (!item) return current; if (item.bounds) { if (!current) current = { min: [...item.bounds.min], max: [...item.bounds.max] }; else for (let i = 0; i < 3; i += 1) { current.min[i] = Math.min(current.min[i], item.bounds.min[i]); current.max[i] = Math.max(current.max[i], item.bounds.max[i]); } } item.childIds.forEach((childId) => { current = boundsFor(childId, current); }); return current; }
  function sphereFor(id) { const bounds = boundsFor(id); if (!bounds || !modelMatrix) return null; const center = Cesium.Cartesian3.fromElements(...bounds.min.map((v, i) => (v + bounds.max[i]) / 2)); const dx = bounds.max[0] - bounds.min[0]; const dy = bounds.max[1] - bounds.min[1]; const dz = bounds.max[2] - bounds.min[2]; return new Cesium.BoundingSphere(Cesium.Matrix4.multiplyByPoint(modelMatrix, center, new Cesium.Cartesian3()), Math.max(Math.hypot(dx, dy, dz) / 2, 1)); }
  function focusNode(id) { const sphere = selectedSphere || sphereFor(id); if (!sphere) return; const offset = new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-28), Math.max(sphere.radius * 3.4, 15)); viewer.camera.flyToBoundingSphere(sphere, { duration: .65, offset, complete: () => viewer.camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(sphere.center), offset) }); }
  function paintFeatures() { const ids = new Set(componentIdsFor(selectedId)); componentFeatures.forEach((features, componentId) => features.forEach((feature) => { const isSelected = Boolean(selectedId && ids.has(componentId)); const hidden = Boolean(selectedId && ((hideUnselected && !isSelected) || (hideSelected && isSelected))); const progress = progressByComponent.get(componentId)?.state; const baseColor = weldProgressEnabled ? (progress === 'welded' ? weldedColor : progress === 'pending' ? pendingColor : normal) : normal; feature.show = !hidden; feature.color = selectedId ? (isSelected ? accent : (dimOthers ? dimmed : baseColor)) : baseColor; })); }
  function setWeldProgressEnabled(enabled) { weldProgressEnabled = enabled; if (tileset) { tileset.style = weldStyle; tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE; tileset.colorBlendAmount = 1; } paintFeatures(); requestAnimationFrame(() => { paintFeatures(); requestAnimationFrame(paintFeatures); }); }
  function clearSelectedNode() { selectedId = null; selectedSphere = null; hideUnselected = false; hideSelected = false; document.querySelector('[data-action="hide-unselected"]')?.classList.remove('active'); document.querySelector('[data-action="hide-selected"]')?.classList.remove('active'); viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY); paintFeatures(); renderTree(); els.selectedTitle.textContent = '未选择构件'; els.selectedDetail.textContent = '从结构树或三维模型中选择构件'; els.propertyList.innerHTML = '<p class="property-empty">焊点编号、元件编号、材料等 EP3D 属性将在此显示。</p>'; els.selectionPanel.hidden = true; }
  function itemAttributes(item) { const attributes = { ...(item.attributes || {}) }; const context = weldContextByNodeId.get(item.id); const pipe = attributes['EP3D_管 线 号'] || context?.pipe; const weld = attributes['EP3D_焊点编号'] || context?.weld; if (pipe && weld) { const status = context?.status || weldStatus.records?.[weldKey(pipe, weld)]; attributes['焊接日期'] = status?.date || '未焊接'; attributes['焊接状态'] = status?.welded ? '已焊接' : '未焊接'; attributes['焊接日期来源'] = status ? '云端焊接数据库' : '未在焊接数据库中找到'; } return attributes; }
  function propertyRows(item) { const entries = Object.entries(itemAttributes(item)); if (!entries.length) return '<p class="property-empty">该结构节点为分组节点，请选择下级构件查看 EP3D 属性。</p>'; return `<dl>${entries.map(([key, value]) => `<div class="property-row"><dt>${label(key)}</dt><dd>${value}</dd></div>`).join('')}</dl>`; }
  function boundsGap(a, b) { const delta = [0, 1, 2].map((i) => Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i], 0)); return Math.hypot(...delta); }
  function markProgress(componentIds, state, priority) { componentIds.forEach((componentId) => { const previous = progressByComponent.get(componentId); if (!previous || priority > previous.priority || (priority === previous.priority && state === 'welded')) progressByComponent.set(componentId, { state, priority }); }); }
  function buildWeldContext() {
    const leaves = Object.values(modelIndex.nodes).filter((item) => item.depth === 5 && item.componentIds.length && item.bounds);
    const welds = leaves.filter((item) => /^weld$/i.test(item.name));
    welds.forEach((weldNode) => {
      const attrs = weldNode.attributes || {}; const pipe = attrs['EP3D_管 线 号']; const weld = attrs['EP3D_焊点编号'];
      if (pipe && weld) weldContextByNodeId.set(weldNode.id, { pipe, weld, status: weldStatus.records?.[weldKey(pipe, weld)] });
    });
    // 部分轻量化节点丢失 EP3D 属性，但它们的父级正是管线号，且 Weld 在其中按焊点编号顺序排列。
    Object.values(modelIndex.nodes).forEach((lineNode) => {
      const children = (lineNode.childIds || []).map(node).filter(Boolean); const weldChildren = children.filter((item) => /^weld$/i.test(item.name));
      if (!weldChildren.length || !weldStatus.records) return;
      weldChildren.forEach((weldNode, index) => {
        if (weldContextByNodeId.has(weldNode.id)) return;
        const pipe = lineNode.name; const weld = String(index + 1); const status = weldStatus.records[weldKey(pipe, weld)];
        if (status) weldContextByNodeId.set(weldNode.id, { pipe, weld, status });
      });
    });
  }
  function buildWeldProgress() {
    const leaves = Object.values(modelIndex.nodes).filter((item) => item.depth === 5 && item.componentIds.length && item.bounds);
    // 先给每个有焊接状态的 Weld 上色，再在同一管线父节点内，把所有拆分出来的组件分配给最近焊口。
    const weldsByParent = new Map();
    leaves.filter((item) => /^weld$/i.test(item.name)).forEach((weldNode) => {
      const context = weldContextByNodeId.get(weldNode.id); const pipe = context?.pipe; const weld = context?.weld;
      if (!pipe || !weld) return;
      const status = context.status || weldStatus.records?.[weldKey(pipe, weld)];
      if (!status) return;
      const state = status.welded ? 'welded' : 'pending';
      markProgress(weldNode.componentIds, state, 2);
      if (!weldsByParent.has(weldNode.parentId)) weldsByParent.set(weldNode.parentId, []);
      weldsByParent.get(weldNode.parentId).push({ node: weldNode, state });
    });
    weldsByParent.forEach((weldEntries, parentId) => {
      const parent = node(parentId); const siblings = (parent?.childIds || []).map(node).filter((candidate) => candidate && !/^weld$/i.test(candidate.name) && candidate.componentIds.length && candidate.bounds);
      siblings.forEach((candidate) => {
        const nearest = weldEntries.reduce((best, entry) => boundsGap(entry.node.bounds, candidate.bounds) < boundsGap(best.node.bounds, candidate.bounds) ? entry : best, weldEntries[0]);
        markProgress(candidate.componentIds, nearest.state, 1);
      });
    });
  }
  function reveal(id) { let current = node(id); while (current?.parentId) { expanded.add(current.parentId); current = node(current.parentId); } renderTree(); requestAnimationFrame(() => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' })); }
  function selectNode(id, { focus = true, revealTree = true } = {}) { const item = node(id); if (!item) return; selectedId = id; selectedSphere = sphereFor(id); if (revealTree) reveal(id); else renderTree(); paintFeatures(); if (focus) focusNode(id); els.selectedTitle.textContent = item.name; els.selectedDetail.textContent = item.path || `${item.componentIds.length} 个关联模型组件`; els.propertyList.innerHTML = propertyRows(item); els.selectionPath.textContent = item.path || item.name; els.selectionPanel.hidden = false; }
  function treeItem(id, filter = '') { const item = node(id); if (!item) return ''; const children = item.childIds || []; const match = !filter || `${item.name} ${item.path} ${Object.values(item.attributes || {}).join(' ')}`.toLowerCase().includes(filter); const childMarkup = children.map((childId) => treeItem(childId, filter)).join(''); if (filter && !match && !childMarkup) return ''; const isOpen = expanded.has(id) || Boolean(filter); const hasChildren = children.length > 0; const icon = item.depth === 5 ? '◇' : hasChildren ? '▣' : '•'; const meta = item.depth === 5 ? item.componentIds.length : '';
    return `<div class="tree-node" style="--depth:${item.depth}"><div class="tree-row ${selectedId === id ? 'selected' : ''}" role="treeitem" aria-expanded="${hasChildren ? isOpen : ''}" data-node-id="${id}"><button class="tree-toggle ${hasChildren ? '' : 'placeholder'}" data-toggle-id="${id}" type="button">${isOpen ? '⌄' : '›'}</button><span class="tree-node-icon">${icon}</span><span class="tree-node-name" title="${item.name}">${item.name}</span><span class="tree-node-meta">${meta}</span></div>${hasChildren ? `<div class="tree-children ${isOpen ? 'open' : ''}">${childMarkup}</div>` : ''}</div>`; }
  function renderTree() { if (!modelIndex) return; const query = els.treeSearch.value.trim().toLowerCase(); els.treeRoot.innerHTML = modelIndex.rootIds.map((id) => treeItem(id, query)).join('') || '<p class="tree-empty">未找到匹配构件</p>'; }
  function bindTree() { els.treeRoot.addEventListener('click', (event) => { const toggle = event.target.closest('[data-toggle-id]'); if (toggle) { const id = toggle.dataset.toggleId; expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderTree(); return; } const row = event.target.closest('[data-node-id]'); if (row) selectNode(row.dataset.nodeId); }); els.treeSearch.addEventListener('input', renderTree); }
  function registerVisibleContent(tile) { const content = tile.content; if (!content || !content.featuresLength || seenContents.has(content)) return; seenContents.add(content); for (let i = 0; i < content.featuresLength; i += 1) { const feature = content.getFeature(i); const componentId = feature.getProperty('componentId'); if (!componentId || !modelIndex.componentToNode[componentId]) continue; if (!componentFeatures.has(componentId)) componentFeatures.set(componentId, new Set()); componentFeatures.get(componentId).add(feature); } paintFeatures(); }

  try {
    setLoading('正在建立结构树与属性索引…');
    const indexPromise = fetch('/models/model-index.json').then((response) => { if (!response.ok) throw new Error('模型索引未生成'); return response.json(); });
    const syncToken = Date.now();
    const weldStatusPromise = fetch(`/api/weld-status?refresh=${syncToken}`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('焊接数据库未就绪'); return response.json(); }).catch(() => fetch(`/models/weld-status.json?refresh=${syncToken}`, { cache: 'no-store' }).then((response) => { if (!response.ok) throw new Error('焊接状态索引未生成'); return response.json(); }).catch((error) => ({ records: {}, error: `焊接数据同步接口不可用：${error.message}` })));
    const origin = Cesium.Cartesian3.fromDegrees(118.795, 32.055, 15); modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    const tilesetPromise = Cesium.Cesium3DTileset.fromUrl('/models/tileset.json', { modelMatrix, modelUpAxis: Cesium.Axis.Z, maximumScreenSpaceError: 24, dynamicScreenSpaceError: true, dynamicScreenSpaceErrorDensity: .001, dynamicScreenSpaceErrorFactor: 8, maximumMemoryUsage: 256, cullWithChildrenBounds: true, progressiveResolutionHeightFraction: .5, skipLevelOfDetail: true, skipScreenSpaceErrorFactor: 16, skipLevels: 1, preferLeaves: true });
    [modelIndex, tileset, weldStatus] = await Promise.all([indexPromise, tilesetPromise, weldStatusPromise]);
    normalizeModelIndex(modelIndex);
    buildWeldContext(); buildWeldProgress();
    modelBounds = Cesium.BoundingSphere.clone(tileset.boundingSphere); weldStyle = new Cesium.Cesium3DTileStyle({ color: "color('#c3ccd2', 0.96)" }); tileset.style = weldStyle; tileset.colorBlendMode = Cesium.Cesium3DTileColorBlendMode.REPLACE; tileset.colorBlendAmount = 1;
    viewer.scene.primitives.add(tileset); tileset.tileVisible.addEventListener(registerVisibleContent); tileset.tileFailed.addEventListener((error) => toast(`模型分块加载失败：${error.message || error.url}`));
    let loadedTileCount = 0; tileset.tileLoad.addEventListener(() => { loadedTileCount += 1; }); tileset.loadProgress.addEventListener((requests, processing) => { const pending = requests + processing; els.pendingTiles.textContent = pending ? `${pending} 项` : `完成 · ${loadedTileCount} 分块`; if (pending) setLoading(`正在加载 ${pending} 个模型分块…`); });
    els.treeCount.textContent = `${modelIndex.stats.objectCount} 构件`; bindTree(); expanded.add(modelIndex.rootIds[0]); renderTree(); reframe(); els.loadState.textContent = weldStatus.error ? '模型已就绪 · 焊接数据待同步' : '模型与焊接数据已就绪'; els.modelState.textContent = '已加载'; els.modelState.classList.add('ready'); setLoading('模型与属性加载完成'); setTimeout(() => els.loadingScreen.classList.add('hide'), 350);
  } catch (error) { console.error(error); els.loadState.textContent = '加载失败'; els.modelState.textContent = '失败'; toast(`模型结构加载失败：${error.message}`); }

  viewer.screenSpaceEventHandler.setInputAction((click) => { const picked = viewer.scene.pick(click.position); if (!picked?.getProperty) return; const componentId = picked.getProperty('componentId'); const id = modelIndex?.componentToNode[componentId]; if (id) selectNode(id); }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => { const action = button.dataset.action; if (action === 'home' || action === 'fit') reframe(); if (action === 'clear-selection') clearSelectedNode(); if (action === 'toggle-dim') { dimOthers = !dimOthers; paintFeatures(); button.classList.toggle('active', dimOthers); button.lastChild.textContent = dimOthers ? '其他虚化' : '显示其他'; } if (action === 'hide-unselected' && selectedId) { hideUnselected = !hideUnselected; if (hideUnselected) hideSelected = false; button.classList.toggle('active', hideUnselected); document.querySelector('[data-action="hide-selected"]')?.classList.toggle('active', hideSelected); paintFeatures(); } if (action === 'hide-selected' && selectedId) { hideSelected = !hideSelected; if (hideSelected) hideUnselected = false; button.classList.toggle('active', hideSelected); document.querySelector('[data-action="hide-unselected"]')?.classList.toggle('active', hideUnselected); paintFeatures(); } if (action === 'toggle-weld-progress') { setWeldProgressEnabled(!weldProgressEnabled); button.classList.toggle('active', weldProgressEnabled); button.lastChild.textContent = weldProgressEnabled ? '焊接状态' : '原模型颜色'; } if (action === 'wireframe' && tileset) { wireframe = !wireframe; tileset.debugWireframe = wireframe; button.classList.toggle('active', wireframe); } if (action === 'background') { lightBackground = !lightBackground; viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(lightBackground ? '#d5e4e8' : '#0b1d2c'); button.classList.toggle('active', lightBackground); } }));
  document.querySelector('[data-action="background"]')?.classList.toggle('active', lightBackground); els.quality.addEventListener('input', (event) => setQuality(event.target.value)); setQuality(els.quality.value);
  const frames = []; viewer.scene.postRender.addEventListener(() => { const now = performance.now(); frames.push(now); while (frames[0] < now - 1000) frames.shift(); if (frames.length > 2) els.fps.textContent = `${frames.length - 1} FPS`; });
  const clock = () => { els.clock.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()); }; clock(); setInterval(clock, 1000);
})();
