/* ============================================================================
 * springgraph — Local Web UI (front-end)
 * Plain JS, no frameworks, no build step. Cytoscape.js v3.x loaded from CDN.
 *
 * API CONTRACT  (server binds to 127.0.0.1:4000 by default, base path /)
 * ----------------------------------------------------------------------------
 * GET /api/status
 *   -> { projectRoot, initialized, lastUpdated, fileCount, nodeCount,
 *        edgeCount, nodesByKind, edgesByKind, filesByLanguage, dbSizeBytes }
 *
 * GET /api/kinds
 *   -> { nodeKinds[], edgeKinds[],
 *        nodeKindColors{ kind->hex }, edgeKindColors{ kind->hex } }
 *
 * GET /api/overview?limit=80
 *   -> { root:null, depth:0, direction:'overview', nodeCount, edgeCount,
 *        nodes: [...], edges: [...] }
 *
 * POST /api/project { path }
 *   -> switch active project. `path` may be a project root or its .springgraph dir.
 *
 * GET /api/browse?path=<dir>|__roots__
 *   -> local directory listing for choosing an indexed project.
 *
 * GET /api/search?q=&limit=&kind=
 *   -> { query, count,
 *        results: [ { score, node: {id,name,kind,filePath,qualifiedName,
 *                                  startLine,endLine,signature,language,color},
 *                    highlights } ] }
 *
 * GET /api/node/<id>           (id URL-encoded)
 *   -> { node, code, callers: [{node,edge}], callees: [{node,edge}],
 *        ancestors: [node], children: [node] }
 *
 * GET /api/context/<id>?depth=1..5&direction=outgoing|incoming|both
 *                       &edgeKinds=calls,imports,...
 *   -> { root, depth, direction, nodeCount, edgeCount,
 *        nodes: [...cytoscape shape], edges: [...cytoscape shape] }
 *
 * GET /api/file?path=&offset=&limit=
 *   -> { path, startLine, endLine, total, content }
 *
 * All responses are JSON. `color` is the hex the backend computed from kind.
 * ============================================================================ */

(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // Tiny DOM helpers
  // ──────────────────────────────────────────────────────────────────────────
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fmtNum(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    return n.toLocaleString('zh-CN');
  }

  function fmtTimestamp(iso) {
    if (!iso) return '—';
    const n = Number(iso);
    if (!Number.isFinite(n) || n <= 0) return '—';
    const d = new Date(n);
    if (isNaN(d.getTime())) return '—';
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return d.toLocaleDateString('zh-CN');
  }

  function translateDirection(direction) {
    return {
      both: '双向',
      incoming: '入边',
      outgoing: '出边',
      overview: '概览',
    }[direction] || direction || '未知';
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(null, args); }, ms);
    };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Single API helper — every server call goes through this. Throws on !ok.
  // ──────────────────────────────────────────────────────────────────────────
  async function apiFetch(path, options) {
    const url = path.startsWith('/') ? path : '/' + path;
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: { Accept: 'application/json', ...(options && options.headers ? options.headers : {}) },
      });
    } catch (e) {
      const err = new Error(`网络错误：${e && e.message ? e.message : e}`);
      err.status = 0;
      throw err;
    }
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body.error || body.message || '';
      } catch (_) { /* not JSON */ }
      const err = new Error(detail || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Theme — light/dark toggle, persisted in localStorage. Default is 'dark'
  // to match the original color scheme. The button label flips between 🌙
  // and ☀ as a visual hint of the current mode.
  // ──────────────────────────────────────────────────────────────────────────
  function getTheme() {
    try { return localStorage.getItem('cg-theme') === 'light' ? 'light' : 'dark'; }
    catch (_) { return 'dark'; }
  }

  function setMode(mode) {
    if (mode !== 'springcloud' && mode !== 'generic') return;
    if (state.mode === mode) return;
    state.mode = mode;
    state.activeRoleFilters = new Set();
    state.activeLayerFilters = new Set();
    state.activeEdgeFilters = new Set();
    $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    const isSC = mode === 'springcloud';
    const roleSection = $('#role-section');
    const layerSection = $('#layer-section');
    if (roleSection) roleSection.hidden = !isSC;
    if (layerSection) layerSection.hidden = !isSC;
    const kindSection = $('#kind-section');
    if (kindSection) kindSection.hidden = isSC;
    const scViewPicker = $('#sc-view-picker');
    if (scViewPicker) scViewPicker.hidden = !isSC;
    renderRoleChips();
    renderLayerChips();
    renderModuleChips();
    renderDetailEmpty();
    rebuildCurrentView();
  }

  function rebuildCurrentView() {
    if (state.focusId) {
      focusNode(state.focusId, { depth: DEFAULT_DEPTH, direction: 'both', incremental: false });
    } else {
      loadOverview();
    }
  }

  function renderRoleChips() {
    const container = $('#role-chips');
    const section = $('#role-section');
    if (!container || !section) return;
    clear(container);
    const roles = state.profile && state.profile.roles ? state.profile.roles : [];
    section.hidden = roles.length === 0;
    roles.forEach((role) => {
      const meta = SC_ROLES[role.id] || { color: role.color || '#94a3b8', glyph: '●', label: role.label || role.id };
      const chip = el('button', 'role-chip', `${meta.glyph} ${meta.label}`);
      chip.type = 'button';
      chip.dataset.role = role.id;
      chip.style.borderLeftColor = meta.color;
      chip.title = `筛选角色：${meta.label || role.id}`;
      if (state.activeRoleFilters.has(role.id)) chip.classList.add('active');
      container.appendChild(chip);
    });
  }

  function renderLayerChips() {
    const container = $('#layer-chips');
    const section = $('#layer-section');
    if (!container || !section) return;
    clear(container);
    const layers = state.profile && state.profile.layers ? state.profile.layers : [];
    section.hidden = layers.length === 0;
    layers.forEach((layer) => {
      const color = LAYER_COLORS[layer.id] || '#94a3b8';
      const chip = el('button', 'layer-chip', layer.label || layer.id);
      chip.type = 'button';
      chip.dataset.layer = layer.id;
      chip.style.borderLeftColor = color;
      chip.title = `筛选分层：${layer.label || layer.id}`;
      if (state.activeLayerFilters.has(layer.id)) chip.classList.add('active');
      container.appendChild(chip);
    });
  }

  function renderModuleChips() {
    const container = $('#module-chips');
    const section = $('#module-section');
    if (!container || !section) return;
    clear(container);
    const modules = state.modules || [];
    section.hidden = state.mode !== 'springcloud' || modules.length === 0;
    modules.forEach((module) => {
      const chip = el('button', 'module-chip', `${module.name} · ${module.count}`);
      chip.type = 'button';
      chip.dataset.module = module.name;
      chip.style.borderLeftColor = stringToColor(module.name);
      chip.title = `筛选模块：${module.name}`;
      if (state.selectedModules.has(module.name)) chip.classList.add('active');
      container.appendChild(chip);
    });
  }

  function renderEdgeChips() {
    const container = $('#edge-type-chips');
    if (!container) return;
    clear(container);
    const edgeColors = (state.kinds && state.kinds.edgeKindColors) || {};
    const order = ['extends', 'implements', 'calls', 'instantiates', 'references', 'decorates', 'imports', 'exports', 'contains', 'overrides', 'returns', 'type_of'];
    const seen = new Set();
    const list = [];
    order.forEach((k) => { if (edgeColors[k]) { list.push(k); seen.add(k); } });
    Object.keys(edgeColors).forEach((k) => { if (!seen.has(k)) list.push(k); });
    list.forEach((kind) => {
      const glyph = SC_EDGE_GLYPHS[kind] || '·';
      const chip = el('button', 'edge-chip', `${glyph} ${kind}`);
      chip.type = 'button';
      chip.dataset.edge = kind;
      chip.style.borderLeftColor = edgeColors[kind] || '#94a3b8';
      chip.title = `切换显示 ${kind} 边`;
      container.appendChild(chip);
    });
  }

  function setTheme(name) {
    const theme = name === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('cg-theme', theme); } catch (_) { /* ignore */ }
    const btn = document.getElementById('btn-theme');
    if (btn) {
      const icon = btn.querySelector('.theme-icon');
      if (icon) icon.textContent = theme === 'light' ? '☀' : '🌙';
      btn.setAttribute('title', theme === 'light' ? '切换到深色' : '切换到浅色');
    }
    // Re-paint the cytoscape canvas so node label colors stay readable.
    applyCytoscapeTheme();
  }

  function toggleTheme() {
    setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  function applyCytoscapeTheme() {
    if (!state.cy) return;
    // cyStyle() already reads the live `data-theme` attribute, so a fresh
    // fromJson + update is enough — no per-selector dance needed.
    state.cy.style().fromJson(cyStyle()).update();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Toast — auto-dismiss after 4s
  // ──────────────────────────────────────────────────────────────────────────
  function showToast(message, kind /* 'error'|'warn'|'ok' */, title) {
    const stack = $('#toast-stack');
    if (!stack) return;
    const t = el('div', 'toast ' + (kind || 'error'));
    if (title) t.appendChild(el('div', 'toast-title', title));
    t.appendChild(el('div', 'toast-msg', message));
    stack.appendChild(t);
    setTimeout(() => {
      t.classList.add('dismissing');
      setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, 4000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // App state
  // ──────────────────────────────────────────────────────────────────────────
  const state = {
    cy: null,
    focusId: null,
    selectedId: null,
    selectedTab: 'code',
    layoutName: 'cose',
    layoutFallback: null,
    activeKindFilter: null,
    activeDecoratorFilter: null,
    lastQuery: '',
    suggestionIdx: -1,
    kinds: { nodeKindColors: {}, edgeKindColors: {} },
    status: null,
    browsePath: null,
    browseParent: null,
    mode: 'springcloud',
    activeRoleFilters: new Set(),
    activeLayerFilters: new Set(),
    activeEdgeFilters: new Set(),
    showEdgeLabels: true,
    modules: [],
    selectedModules: new Set(),
    // Phase 7 profile-driven state
    profileId: null,
    activeProfile: null,
    profileConfidence: 0,
    facets: {},
    profile: null,
    groupBy: 'role',
    colorBy: 'role',
    selectedTrace: null,
    selectedImpact: null,
    // MCP Playground state — populated lazily on first modal open.
    pgTools: null,
    pgSelectedTool: null,
    pgRawMode: false,
    pgInvoking: false,
  };

  const SEARCH_LIMIT = 50;     // dropdown cap
  const DEFAULT_DEPTH = 2;
  const EXPAND_DEPTH  = 3;

  const SC_ROLES = {
    controller:        { color: '#ef4444', glyph: 'C',  label: 'Controller' },
    'controller-advice': { color: '#f97316', glyph: '⚠',  label: 'ControllerAdvice' },
    service:           { color: '#3b82f6', glyph: 'S',  label: 'Service' },
    'service-impl':    { color: '#60a5fa', glyph: 'S',  label: 'ServiceImpl' },
    'feign-client':    { color: '#a855f7', glyph: 'F',  label: 'FeignClient' },
    mapper:            { color: '#10b981', glyph: 'M',  label: 'Mapper' },
    repository:        { color: '#14b8a6', glyph: 'R',  label: 'Repository' },
    entity:            { color: '#facc15', glyph: 'E',  label: 'Entity/PO/DTO' },
    config:            { color: '#94a3b8', glyph: '⚙',  label: 'Config' },
    app:               { color: '#f59e0b', glyph: 'A',  label: 'Application' },
    component:         { color: '#22d3ee', glyph: '◉',  label: 'Component' },
    scheduler:         { color: '#fb7185', glyph: '⏰', label: 'Scheduler' },
    'event-listener':  { color: '#f43f5e', glyph: '⚡', label: 'EventListener' },
    filter:            { color: '#06b6d4', glyph: '🛡', label: 'Filter' },
    websocket:         { color: '#8b5cf6', glyph: '◌', label: 'WebSocket' },
  };
  const SC_ROLE_ORDER = Object.keys(SC_ROLES);

  function getNodeRole(node) {
    if (!node || !node.id) return null;
    const facet = state.facets[node.id];
    return facet && facet.role ? facet.role : null;
  }

  function getNodeLayer(node) {
    if (!node || !node.id) return null;
    const facet = state.facets[node.id];
    return facet && facet.layer ? facet.layer : null;
  }

  function getNodeModule(node) {
    if (!node || !node.filePath) return null;
    const first = node.filePath.split('/')[0];
    if (!first || first === 'src' || first === 'test' || first === 'tests') return null;
    return first;
  }

  function getNodeColor(node) {
    const colorBy = state.colorBy;
    if (colorBy === 'role') {
      const role = getNodeRole(node);
      if (role && SC_ROLES[role]) return SC_ROLES[role].color;
    } else if (colorBy === 'layer') {
      const layer = getNodeLayer(node);
      if (layer && state.profile && state.profile.layers) {
        const l = state.profile.layers.find((x) => x.id === layer);
        if (l && l.color) return l.color;
      }
      if (layer) return LAYER_COLORS[layer] || '#94a3b8';
    } else if (colorBy === 'module') {
      const mod = getNodeModule(node);
      if (mod) return stringToColor(mod);
    }
    return node.color || (state.kinds.nodeKindColors && state.kinds.nodeKindColors[node.kind]) || '#94a3b8';
  }

  const LAYER_COLORS = {
    entry: '#ef4444',
    remote: '#a855f7',
    business: '#3b82f6',
    data: '#10b981',
    model: '#facc15',
    infra: '#94a3b8',
    unknown: '#64748b',
  };

  function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
  }

  function appendFilterParams(params) {
    if (state.activeRoleFilters.size > 0) {
      params.set('role', Array.from(state.activeRoleFilters).join(','));
    }
    if (state.activeLayerFilters.size > 0) {
      params.set('layer', Array.from(state.activeLayerFilters).join(','));
    }
    if (state.selectedModules && state.selectedModules.size > 0) {
      params.set('module', Array.from(state.selectedModules).join(','));
    }
    return params;
  }

  // Edge-kind display + classification. Grouped by directionality for the
  // edge-type filter chips. Each kind gets a glyph shown on the chip and
  // (when labels are on) along the edge itself.
  const SC_EDGE_GLYPHS = {
    extends:      '↦',
    implements:   '⇢',
    calls:        '→',
    instantiates: '◇→',
    references:   '·→',
    imports:      '⇢',
    exports:      '⇠',
    contains:     '⊂',
    type_of:      ':',
    returns:      '←',
    overrides:    '⊃',
    decorates:    '★',
  };
  function edgeDirectional(kind) {
    switch (kind) {
      case 'calls':         return 'forward';
      case 'extends':       return 'back';
      case 'implements':    return 'back';
      case 'instantiates':  return 'forward';
      case 'references':    return 'forward';
      case 'imports':       return 'forward';
      case 'exports':       return 'back';
      case 'returns':       return 'back';
      case 'overrides':     return 'back';
      case 'type_of':       return 'forward';
      case 'contains':      return 'forward';
      case 'decorates':     return 'back';
      default:              return 'forward';
    }
  }
  function edgeShowArrow(kind) {
    return kind !== 'contains';
  }

  async function loadProfile() {
    try {
      const data = await apiFetch('/api/architecture/profiles');
      state.profileId = data.profileId || 'generic';
      state.activeProfile = data.profileName || data.activeProfile || 'Generic';
      state.profileConfidence = data.profileConfidence || 0;
      state.profile = data;
      renderProfilePill();
      renderRoleChips();
      renderLayerChips();
      renderModuleChips();
    } catch (err) {
      console.warn('loadProfile failed', err);
    }
  }

  function renderProfilePill() {
    const pill = $('#profile-pill');
    const nameEl = $('#profile-name');
    const confEl = $('#profile-confidence');
    if (!pill || !nameEl || !confEl) return;
    const name = state.activeProfile || 'Generic';
    const conf = Math.round((state.profileConfidence || 0) * 100);
    nameEl.textContent = name;
    confEl.textContent = conf + '%';
    pill.hidden = false;
  }

  function openEvidenceModal() {
    const modal = $('#evidence-modal');
    const body = $('#evidence-modal-body');
    const sub = $('#evidence-subtitle');
    if (!modal || !body || !sub) return;
    clear(body);
    sub.textContent = `${state.activeProfile || 'Generic'} · 置信度 ${Math.round((state.profileConfidence || 0) * 100)}%`;
    const matches = (state.profile && state.profile.matches) || [];
    if (!matches.length) {
      body.appendChild(el('div', 'evidence-empty', '暂无检测依据。'));
    } else {
      matches.forEach((m) => {
        const row = el('div', 'evidence-item');
        row.appendChild(el('div', 'evidence-name', m.profileName || '—'));
        row.appendChild(el('div', 'evidence-score', `置信度 ${Math.round((m.confidence || 0) * 100)}% · ${m.nodeCount || 0} 节点`));
        body.appendChild(row);
      });
    }
    modal.hidden = false;
  }

  function closeEvidenceModal() {
    const modal = $('#evidence-modal');
    if (modal) modal.hidden = true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Stats + project path
  // ──────────────────────────────────────────────────────────────────────────
  async function refreshStats() {
    try {
      const s = await apiFetch('/api/status');
      state.status = s;
      $('#stat-files').textContent = fmtNum(s.fileCount);
      $('#stat-nodes').textContent = fmtNum(s.nodeCount);
      $('#stat-edges').textContent = fmtNum(s.edgeCount);
      const pp = $('#project-path');
      pp.value = s.projectRoot || '';
      pp.title = s.projectRoot || '';
      if (s.lastUpdated) {
        $('#stat-update-wrap').hidden = false;
        $('#stat-update').textContent = fmtTimestamp(s.lastUpdated);
      $('#stat-update').title = new Date(Number(s.lastUpdated)).toLocaleString('zh-CN');
      } else {
        $('#stat-update-wrap').hidden = true;
      }
    } catch (err) {
      showToast(err.message || '状态获取失败', 'error', '接口错误');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Kind chips — fetched from /api/kinds at startup, never hardcoded.
  // ──────────────────────────────────────────────────────────────────────────
  const POPULAR_KINDS = ['function', 'method', 'class', 'interface', 'struct', 'trait', 'protocol', 'component', 'route', 'type_alias', 'constant', 'enum'];

  async function loadKinds() {
    try {
      const k = await apiFetch('/api/kinds');
      state.kinds = k;
      const chips = $('#kind-chips');
      clear(chips);

      const all = el('button', 'chip active');
      all.type = 'button';
      all.dataset.kind = '';
      all.textContent = '全部';
      all.title = '显示所有类型';
      chips.appendChild(all);

      // Popular kinds first, then the rest in server order.
      const seen = new Set(['']);
      const order = [];
      POPULAR_KINDS.forEach((kk) => { if (k.nodeKinds.includes(kk)) order.push(kk); });
      k.nodeKinds.forEach((kk) => { if (!order.includes(kk)) order.push(kk); });
      order.forEach((kind) => {
        if (seen.has(kind)) return;
        seen.add(kind);
        const color = k.nodeKindColors[kind] || '#94a3b8';
        const chip = el('button', 'chip', kind);
        chip.type = 'button';
        chip.dataset.kind = kind;
        chip.style.borderLeftColor = color;
        chip.title = kind;
        chips.appendChild(chip);
      });
      chips.addEventListener('click', onChipClick);
    } catch (err) {
      showToast(err.message || '类型列表获取失败', 'error', '接口错误');
    }
  }

  function onChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    $$('#kind-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.activeKindFilter = chip.dataset.kind || null;
    runSearch($('#search-input').value);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Decorator chips — fetched from /api/decorators at startup. Mirrors
  // loadKinds()'s shape (one toolbar + per-value chips) but with its own
  // container and an "All" sentinel chip that's active by default. Click
  // updates state and re-runs the search.
  // ──────────────────────────────────────────────────────────────────────────
  async function loadDecorators() {
    const container = $('#decorator-chips');
    if (!container) return;
    try {
      const data = await apiFetch('/api/decorators?limit=60');
      const decorators = data.decorators || [];
      state.decoratorTags = decorators;
      if (decorators.length === 0) {
        container.innerHTML = '<div class="chips-empty">当前项目无装饰器</div>';
        return;
      }
      container.innerHTML = '';

      // "All" chip — clears the active decorator filter.
      const allChip = el('button', 'chip chip-all active');
      allChip.type = 'button';
      allChip.dataset.decorator = '';
      allChip.textContent = '全部';
      container.appendChild(allChip);

      // One chip per decorator. The accent border-left matches the
      // kind-chip pattern so the two toolbars read as siblings.
      for (const d of decorators) {
        const chip = el('button', 'chip', d.name);
        chip.type = 'button';
        chip.dataset.decorator = d.name;
        chip.title = `${d.count} 个节点`;
        container.appendChild(chip);
      }

      container.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeDecoratorFilter = chip.dataset.decorator || null;
        runSearch($('#search-input').value);
      });
    } catch (err) {
      container.innerHTML = '<div class="chips-empty">装饰器加载失败</div>';
      console.warn('loadDecorators failed', err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Search (debounced 250ms, cap 50 results in dropdown)
  // ──────────────────────────────────────────────────────────────────────────
  function positionSuggestions() {
    const input = $('#search-input');
    const suggest = $('#search-suggestions');
    if (!input || !suggest || suggest.hidden) return;
    const r = input.getBoundingClientRect();
    suggest.style.top = (r.bottom + 4) + 'px';
    suggest.style.left = r.left + 'px';
    suggest.style.width = r.width + 'px';
  }
  function showSuggestions() {
    const suggest = $('#search-suggestions');
    if (!suggest) return;
    positionSuggestions();
    suggest.hidden = false;
  }
  function hideSuggestions() {
    const suggest = $('#search-suggestions');
    if (suggest) suggest.hidden = true;
    state.suggestionIdx = -1;
    $$('#search-suggestions .result').forEach((el) => el.classList.remove('suggestion-active'));
  }
  function highlightSuggestion(i) {
    const items = $$('#search-suggestions .result');
    if (!items.length) { state.suggestionIdx = -1; return; }
    if (i < 0) i = 0;
    if (i >= items.length) i = items.length - 1;
    items.forEach((el, idx) => el.classList.toggle('suggestion-active', idx === i));
    if (items[i] && items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest' });
    state.suggestionIdx = i;
  }

  async function runSearch(q) {
    state.lastQuery = q;
    const suggest = $('#search-suggestions');
    const q2 = (q || '').trim();
    if (!suggest) return;
    clear(suggest);
    state.suggestionIdx = -1;

    if (!q2) {
      hideSuggestions();
      return;
    }
    try {
      const params = new URLSearchParams({ q: q2, limit: String(SEARCH_LIMIT) });
      if (state.activeKindFilter) params.set('kind', state.activeKindFilter);
      if (state.activeDecoratorFilter) params.set('decorator', state.activeDecoratorFilter);
      appendFilterParams(params);
      const data = await apiFetch('/api/search?' + params.toString());

      clear(suggest);
      if (!data.results || !data.results.length) {
        suggest.appendChild(el('div', 'suggestion-empty', `没有匹配"${q2}"的结果。`));
        showSuggestions();
        return;
      }

      const frag = document.createDocumentFragment();
      data.results.forEach((r) => {
        if (!r || !r.node) return;
        const row = el('div', 'result');
        if (state.focusId && r.node.id === state.focusId) row.classList.add('focused');
        row.dataset.id = r.node.id;

        const head = el('div', 'result-name');
        const dot = el('span', 'result-kind-dot');
        dot.style.background = r.node.color || '#94a3b8';
        head.appendChild(dot);
        head.appendChild(document.createTextNode(r.node.name));
        if (typeof r.score === 'number') {
          head.appendChild(el('span', 'result-score', r.score.toFixed(2)));
        }
        row.appendChild(head);

        const locParts = [];
        if (r.node.filePath) locParts.push(r.node.filePath);
        if (r.node.startLine != null) locParts.push(':' + r.node.startLine);
        row.appendChild(el('div', 'result-loc', locParts.join('') || '—'));

        row.addEventListener('click', () => {
          focusNode(r.node.id);
          hideSuggestions();
        });
        frag.appendChild(row);
      });
      suggest.appendChild(frag);
      state.suggestionIdx = 0;
      highlightSuggestion(0);
      showSuggestions();
    } catch (err) {
      clear(suggest);
      suggest.appendChild(el('div', 'suggestion-empty', `搜索失败：${err.message}`));
      showSuggestions();
      showToast(err.message || '搜索失败', 'error', '接口错误');
    }
  }

  const debouncedSearch = debounce((q) => runSearch(q), 250);

  // ──────────────────────────────────────────────────────────────────────────
  // Startup overview — real project data before the user searches.
  // ──────────────────────────────────────────────────────────────────────────
  async function loadOverview() {
    state.focusId = null;
    state.selectedId = null;
    try {
      let url;
      if (state.mode === 'springcloud') {
        const params = new URLSearchParams({ limit: '120' });
        appendFilterParams(params);
        url = '/api/architecture/overview?' + params.toString();
      } else {
        url = '/api/overview?limit=80&mode=' + (state.mode || 'generic');
      }
      const data = await apiFetch(url);
      state.overview = data;
      if (data.facets) state.facets = data.facets;
      state.modules = Object.entries(data.moduleBreakdown || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      renderRoleChips();
      renderLayerChips();
      renderModuleChips();
      renderGraph({
        nodes: data.nodes || [],
        edges: data.edges || [],
        rootId: null,
        depth: data.depth || 0,
        direction: data.direction || 'overview',
      }, { incremental: false });
      clearSelection();
      renderDetailEmpty();
      if (data.nodes && data.nodes.length) {
        $('#empty-state').hidden = true;
      }
    } catch (err) {
      showToast(err.message || '项目概览加载失败', 'error', '接口错误');
    }
  }

  async function switchProject(rawPath) {
    const nextPath = (rawPath || '').trim();
    if (!nextPath) {
      showToast('请输入项目根目录或 .springgraph 目录路径。', 'warn');
      return;
    }
    const button = $('#btn-project-load');
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '加载中…';
    try {
      await apiFetch('/api/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: nextPath }),
      });
      state.focusId = null;
      state.selectedId = null;
      state.lastQuery = '';
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      clearSelection();
      $('#search-input').value = '';
      runSearch('');
      await refreshStats();
      await loadOverview();
      showToast('已切换到新的 springgraph 索引。', 'ok', '加载完成');
    } catch (err) {
      showToast(err.message || '切换项目失败', 'error', '加载失败');
    } finally {
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function openBrowseModal() {
    $('#browse-modal').hidden = false;
    browseTo($('#project-path').value || null);
  }

  function closeBrowseModal() {
    $('#browse-modal').hidden = true;
  }

  async function browseTo(targetPath) {
    try {
      const endpoint = targetPath
        ? '/api/browse?path=' + encodeURIComponent(targetPath)
        : '/api/browse';
      const data = await apiFetch(endpoint);
      if (data.roots) {
        renderRoots(data.roots);
        return;
      }
      state.browsePath = data.path;
      state.browseParent = data.parent;
      $('#browse-path').textContent = data.path || '—';
      $('#btn-browse-parent').disabled = !data.parent;
      $('#btn-browse-select-current').disabled = !(data.isSpringgraphProject || data.isSpringgraphDir);
      renderDirectoryEntries(data.entries || []);
    } catch (err) {
      showToast(err.message || '目录读取失败', 'error', '浏览失败');
    }
  }

  function renderRoots(roots) {
    state.browsePath = null;
    state.browseParent = null;
    $('#browse-path').textContent = '磁盘根目录';
    $('#btn-browse-parent').disabled = true;
    $('#btn-browse-select-current').disabled = true;
    const list = $('#browse-list');
    clear(list);
    if (!roots.length) {
      list.appendChild(el('div', 'browse-empty', '没有可用根目录。'));
      return;
    }
    roots.forEach((root) => {
      list.appendChild(createBrowseRow(root.name, root.path, '磁盘', false));
    });
  }

  function renderDirectoryEntries(entries) {
    const list = $('#browse-list');
    clear(list);
    if (!entries.length) {
      list.appendChild(el('div', 'browse-empty', '这个目录下没有子目录。'));
      return;
    }
    entries.forEach((entry) => {
      const loadable = entry.isSpringgraphProject || entry.isSpringgraphDir;
      const meta = entry.isSpringgraphDir
        ? '.springgraph 索引目录'
        : entry.isSpringgraphProject
          ? 'springgraph 项目根目录'
          : '目录';
      list.appendChild(createBrowseRow(entry.name, entry.path, meta, loadable));
    });
  }

  function createBrowseRow(name, targetPath, meta, loadable) {
    const row = el('div', 'browse-row');
    const main = el('div', 'browse-main');
    main.appendChild(el('div', 'browse-name', name));
    const metaEl = el('div', 'browse-meta', meta);
    if (loadable) metaEl.classList.add('browse-tag');
    main.appendChild(metaEl);
    row.appendChild(main);

    const button = el('button', loadable ? 'btn primary' : 'btn', loadable ? '加载' : '打开');
    button.type = 'button';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (loadable) {
        $('#project-path').value = targetPath;
        closeBrowseModal();
        switchProject(targetPath);
      } else {
        browseTo(targetPath);
      }
    });
    row.appendChild(button);
    row.addEventListener('click', () => browseTo(targetPath));
    return row;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cytoscape styling
  // ──────────────────────────────────────────────────────────────────────────
  function cyStyle() {
    // Theme-conditional palette — Cytoscape paints to its own canvas so the
    // CSS vars don't reach the labels. Read `data-theme` once per call so
    // applyCytoscapeTheme() can re-render after a toggle without rebuilding
    // the instance. (See setTheme() / applyCytoscapeTheme() above.)
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const labelColor = isLight ? '#0f172a' : '#e2e8f0';
    const outlineColor = isLight ? '#ffffff' : '#0f172a';
    const focusedLabel = isLight ? '#0e7490' : '#67e8f9';
    return [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          'border-color': isLight ? '#94a3b8' : '#0f172a',
          'border-width': 2,
          'label': 'data(label)',
          'color': labelColor,
          'font-family': 'JetBrains Mono, ui-monospace, Menlo, Consolas, monospace',
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 6,
          'text-outline-color': outlineColor,
          'text-outline-width': 2,
          'width': 22,
          'height': 22,
          'overlay-padding': '6px',
        },
      },
      {
        selector: 'node.focused',
        style: {
          'border-color': '#22d3ee',
          'border-width': 4,
          'width': 32,
          'height': 32,
          'font-size': '12px',
          'font-weight': 700,
          'color': focusedLabel,
          'text-outline-color': outlineColor,
        },
      },
      {
        selector: 'node.selected',
        style: {
          'border-color': '#fbbf24',
          'border-width': 4,
          'width': 28,
          'height': 28,
        },
      },
      {
        selector: 'node.dim',
        style: { 'opacity': 0.25 },
      },
      {
        selector: 'edge',
        style: {
          'line-color': 'data(color)',
          'target-arrow-color': 'data(color)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          'curve-style': 'bezier',
          'width': 1.4,
          'opacity': 0.85,
          'label': 'data(label)',
          'font-family': 'JetBrains Mono, ui-monospace, Menlo, Consolas, monospace',
          'font-size': '8px',
          'color': isLight ? '#475569' : '#cbd5e1',
          'text-background-color': outlineColor,
          'text-background-opacity': 0.85,
          'text-background-padding': '1px',
          'text-rotation': 'autorotate',
          'line-style': 'data(lineStyle)',
        },
      },
      {
        selector: 'edge[showArrow = "false"]',
        style: {
          'target-arrow-shape': 'none',
          'arrow-scale': 0.5,
        },
      },
      {
        selector: 'edge[direction = "back"]',
        style: {
          'source-arrow-shape': 'triangle',
          'source-arrow-color': 'data(color)',
          'line-style': 'dashed',
        },
      },
      {
        selector: 'edge[kind = "extends"]',
        style: {
          'line-style': 'solid',
          'width': 2.2,
          'target-arrow-shape': 'triangle-tee',
        },
      },
      {
        selector: 'edge[kind = "implements"]',
        style: {
          'line-style': 'dashed',
          'width': 1.8,
          'target-arrow-shape': 'triangle-tee',
        },
      },
      {
        selector: 'edge[kind = "calls"]',
        style: {
          'width': 1.6,
          'target-arrow-shape': 'triangle',
        },
      },
      {
        selector: 'edge[kind = "decorates"]',
        style: {
          'line-style': 'dotted',
          'width': 1.2,
          'target-arrow-shape': 'none',
        },
      },
      {
        selector: 'edge[kind = "imports"]',
        style: {
          'line-style': 'dashed',
          'width': 1.2,
          'target-arrow-shape': 'triangle',
        },
      },
      {
        selector: 'edge.dim',
        style: { 'opacity': 0.15 },
      },
    ];
  }

  function layoutOpts(name) {
    switch (name) {
      case 'breadthfirst':
        return {
          name: 'breadthfirst',
          animate: false,
          fit: true,
          padding: 40,
          directed: true,
          spacingFactor: 1.25,
          avoidOverlap: true,
        };
      case 'circle':
        return {
          name: 'circle',
          animate: false,
          fit: true,
          padding: 50,
          spacingFactor: 1.5,
          avoidOverlap: true,
        };
      case 'grid':
        return {
          name: 'grid',
          animate: false,
          fit: true,
          padding: 40,
          spacingFactor: 1.2,
          avoidOverlap: true,
        };
      case 'concentric':
        return {
          name: 'concentric',
          animate: false,
          fit: true,
          padding: 50,
          concentric: function (n) {
            return n.id() === state.focusId ? 100 : 10;
          },
          levelWidth: function () { return 1; },
          minNodeSpacing: 40,
        };
      case 'modules':
        return {
          name: 'circle',
          animate: true,
          animationDuration: 400,
          fit: true,
          padding: 50,
          spacingFactor: 1.6,
          avoidOverlap: true,
          minNodeSpacing: 60,
        };
      case 'layered':
        if (typeof cytoscape !== 'undefined' && typeof cytoscape.layout !== 'undefined' && window.cytoscapeDagre) {
          state.layoutFallback = null;
          return {
            name: 'dagre',
            animate: true,
            animationDuration: 400,
            fit: true,
            padding: 50,
            rankDir: 'TB',
            nodeSep: 50,
            edgeSep: 30,
            rankSep: 80,
            acyclicer: 'greedy',
            ranker: 'tight-tree',
          };
        }
        state.layoutFallback = 'breadthfirst';
        return { name: 'breadthfirst', animate: true, fit: true, padding: 50, directed: true, spacingFactor: 1.4, avoidOverlap: true };
      case 'cose':
      default:
        return {
          name: 'cose',
          animate: true,
          animationDuration: 300,
          animationEasing: 'ease-out',
          fit: true,
          padding: 50,
          idealEdgeLength: function () { return 80; },
          nodeRepulsion: function () { return 8000; },
          edgeElasticity: function () { return 100; },
          nestingFactor: 1.2,
          gravity: 0.3,
          numIter: 400,           // Was 1500 — 400 converges faster
          randomize: false,
          stop: function () {     // Earlier stop if stable
            const max = this.maxIterations || 400;
            return false;
          },
        };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Render graph — full rebuild vs incremental
  // ──────────────────────────────────────────────────────────────────────────
  function buildCyElements(apiNodes, apiEdges) {
    const isSC = state.mode === 'springcloud';

    const cyNodes = apiNodes.map((n) => {
      const role = getNodeRole(n);
      const layer = getNodeLayer(n);
      const mod = getNodeModule(n);
      const baseColor = n.color || (state.kinds.nodeKindColors && state.kinds.nodeKindColors[n.kind]) || '#94a3b8';
      const color = getNodeColor(n);
      const meta = role && SC_ROLES[role] ? SC_ROLES[role] : null;
      const label = isSC && meta ? `${meta.glyph} ${n.name || n.id}` : (n.name || n.id);
      return {
        group: 'nodes',
        data: {
          id: n.id,
          label,
          kind: n.kind,
          color,
          baseColor,
          role: role || '',
          layer: layer || '',
          module: mod || '',
          filePath: n.filePath || '',
          qualifiedName: n.qualifiedName || '',
          startLine: n.startLine,
          endLine: n.endLine,
          signature: n.signature || '',
          language: n.language || '',
        },
      };
    });

    const cyEdges = apiEdges.map((e) => {
      const kind = e.kind || 'reference';
      const baseColor = e.color || (state.kinds.edgeKindColors && state.kinds.edgeKindColors[kind]) || '#475569';
      const showArr = edgeShowArrow(kind);
      const dir = edgeDirectional(kind);
      const label = state.showEdgeLabels ? `${SC_EDGE_GLYPHS[kind] || '·'} ${kind}` : '';
      const provenance = e.provenance || 'tree-sitter';
      return {
        group: 'edges',
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          label,
          kind,
          color: baseColor,
          baseColor,
          showArrow: showArr,
          direction: dir,
          provenance,
          lineStyle: provenance === 'heuristic' ? 'dotted' : (kind === 'implements' || kind === 'imports' ? 'dashed' : 'solid'),
        },
      };
    });
    return { cyNodes, cyEdges };
  }

  function applyFiltersToCy() {
    if (!state.cy) return;
    state.cy.batch(() => {
      state.cy.edges().forEach((e) => {
        const kind = e.data('kind');
        const inEdgeSet = state.activeEdgeFilters.size === 0 || state.activeEdgeFilters.has(kind);
        e.toggleClass('dim', !inEdgeSet);
        e.style('display', inEdgeSet ? 'element' : 'none');
      });
    });
  }

  function renderGraph(payload, opts) {
    opts = opts || {};
    const { nodes, edges, rootId, depth, direction } = payload;
    const meta = $('#canvas-meta');
    const noConn = $('#no-conn-msg');
    const empty = $('#empty-state');

    const hasNoEdges = !edges || edges.length === 0;
    const hasNoNodes = !nodes || nodes.length === 0;

    if (hasNoNodes) {
      // Server never returns this (includeStart:true) — but defend anyway.
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      empty.hidden = false;
      noConn.hidden = true;
      meta.textContent = '';
      return;
    }

    // Defensive cap — Cytoscape becomes unusable past a few thousand elements.
    // The server should cap upstream, but defend here in case a custom request slips through.
    const HARD_NODE_CAP = 2000;
    const HARD_EDGE_CAP = 4000;
    const wasTruncated = nodes.length > HARD_NODE_CAP || edges.length > HARD_EDGE_CAP;
    const renderNodes = wasTruncated ? nodes.slice(0, HARD_NODE_CAP) : nodes;
    const renderEdges = wasTruncated ? edges.filter((e) =>
      renderNodes.some((n) => n.id === e.source) && renderNodes.some((n) => n.id === e.target)
    ).slice(0, HARD_EDGE_CAP) : edges;
    if (wasTruncated) {
      showToast('视图元素过多，已截断显示。请搜索具体符号查看完整邻域。', 'warn');
    }

    empty.hidden = true;
    if (direction === 'overview' && state.mode === 'springcloud' && state.overview && state.overview.roleBreakdown) {
      const bd = state.overview.roleBreakdown;
      const parts = [];
      const order = ['controller', 'service-impl', 'service', 'mapper', 'feign-client', 'config', 'entity'];
      for (const r of order) if (bd[r]) parts.push(`${r}×${bd[r]}`);
      const rest = Object.entries(bd).filter(([k]) => !order.includes(k)).reduce((a, [, v]) => a + v, 0);
      if (rest > 0) parts.push(`其他×${rest}`);
      const rule = parts.length ? parts.join(' · ') : `${nodes.length} 节点`;
      const fallback = state.layoutName === 'layered' && state.layoutFallback ? ` · dagre 不可用，回退到 ${state.layoutFallback}` : '';
      meta.textContent = `架构概览 · ${nodes.length} 个节点 · ${edges.length} 条边 · ${rule}${fallback}`;
      meta.title = '按后端检测到的架构角色、分层和模块渲染。';
    } else {
      const fallback = state.layoutName === 'layered' && state.layoutFallback ? ` · dagre 不可用，回退到 ${state.layoutFallback}` : '';
      meta.textContent = direction === 'overview'
        ? `项目概览 · ${nodes.length} 个节点 · ${edges.length} 条边${fallback}`
        : `${nodes.length} 个节点 · ${edges.length} 条边 · 深度 ${depth} · ${translateDirection(direction)}`;
    }

    if (hasNoEdges) {
      noConn.hidden = false;
      noConn.innerHTML = direction === 'overview'
        ? '当前概览没有可见连接边；搜索具体符号可查看它的邻域关系。'
        : `深度 ${depth} 内没有连接 <span style="color:var(--dim)">(方向：${translateDirection(direction)})</span>。`;
    } else {
      noConn.hidden = true;
    }

    const { cyNodes, cyEdges } = buildCyElements(renderNodes, renderEdges);

    if (opts.incremental && state.cy) {
      // Re-layout only NEW nodes — don't jump existing ones.
      const existingNodeIds = new Set(state.cy.nodes().map((n) => n.id()));
      const existingEdgeIds = new Set(state.cy.edges().map((e) => e.id()));
      const newNodes = cyNodes.filter((n) => !existingNodeIds.has(n.data.id));
      const newEdges = cyEdges.filter((e) => !existingEdgeIds.has(e.data.id));
      if (newNodes.length) state.cy.add(newNodes);
      if (newEdges.length) state.cy.add(newEdges);
      if (newNodes.length || newEdges.length) {
        // Only animate the new nodes into place; existing nodes stay where they are.
        if (newNodes.length > 0 && newNodes.length < 50) {
          const newEles = state.cy.collection(newNodes.map((n) => state.cy.getElementById(n.data.id)));
          newEles.layout({
            name: 'cose',
            animate: true,
            animationDuration: 200,
            randomize: true,
            fit: false,
            // Use the existing positions as anchor points.
            ready: function () { /* no-op */ },
            stop: function () { /* no-op */ },
          }).run();
        } else if (newNodes.length > 0) {
          // Too many new nodes — fall back to full layout but with lower iterations.
          state.cy.layout(layoutOpts(state.layoutName)).run();
        }
      }
    } else {
      // Full rebuild — destroy first to avoid position glitches.
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      state.cy = cytoscape({
        container: document.getElementById('cy'),
        elements: cyNodes.concat(cyEdges),
        minZoom: 0.1,
        maxZoom: 4,
        wheelSensitivity: 0.3,    // NEW — smoother zoom on large graphs
        pixelRatio: 'auto',         // Cap DPR for perf on retina
        style: cyStyle(),
      });
      state.cy.layout(layoutOpts(state.layoutName)).run();
    }

    // Focus highlight — focus node bright, everything else slightly dimmed.
    if (state.cy && rootId) {
      state.cy.elements().removeClass('focused selected dim');
      const root = state.cy.getElementById(rootId);
      if (root && root.length) {
        root.addClass('focused');
        try {
          const others = state.cy.elements().difference(root.closedNeighborhood());
          others.addClass('dim');
        } catch (_) { /* closedNeighborhood might miss on 1-node graphs */ }
        state.cy.fit(state.cy.elements(), 60);
      }
    }

    applyFiltersToCy();
    wireCyHandlers();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cytoscape event wiring (only attached once per cy instance)
  // ──────────────────────────────────────────────────────────────────────────
  function wireCyHandlers() {
    if (!state.cy || state.cy.__wired) return;
    state.cy.__wired = true;
    const tip = $('#tooltip');

    state.cy.on('tap', 'node', function (evt) {
      focusNode(evt.target.id());
    });

    state.cy.on('mouseover', 'node', function (evt) {
      const n = evt.target;
      const qn = n.data('qualifiedName') || n.data('label') || n.id();
      const loc = (n.data('filePath') || '?') + ':' + (n.data('startLine') != null ? n.data('startLine') : '?');
      tip.innerHTML = '<div class="tooltip-name">' + escapeHtml(qn) + '</div>' +
                      '<div class="tooltip-loc">' + escapeHtml(loc) + '</div>';
      tip.hidden = false;
      positionTooltip(evt.originalEvent);
    });

    state.cy.on('mouseout', 'node', function () {
      tip.hidden = true;
    });

    state.cy.on('mousemove', 'node', function (evt) {
      positionTooltip(evt.originalEvent);
    });

    state.cy.on('tap', function (evt) {
      // Tapped background (not a node) — deselect.
      if (evt.target === state.cy) clearSelection();
    });
  }

  function positionTooltip(evt) {
    const tip = $('#tooltip');
    if (!evt || tip.hidden) return;
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Focus = fetch context + render graph + select detail
  // ──────────────────────────────────────────────────────────────────────────
  async function focusNode(id, opts) {
    opts = opts || {};
    if (!id) return;
    const depth = opts.depth || DEFAULT_DEPTH;
    const direction = opts.direction || 'both';
    state.focusId = id;
    $('#empty-state').hidden = true;

    try {
      const params = new URLSearchParams({ depth: String(depth), direction });
      appendFilterParams(params);
      const data = await apiFetch(
        `/api/context/${encodeURIComponent(id)}?${params.toString()}`
      );
      renderGraph({
        nodes: data.nodes,
        edges: data.edges,
        rootId: id,
        depth: data.depth,
        direction: data.direction,
      }, { incremental: !!opts.incremental });
      // Detail panel follows the focus.
      await selectNode(id);
      // Re-render the search list so the focused row gets its highlight.
      if (state.lastQuery) runSearch(state.lastQuery);
    } catch (err) {
      showToast(err.message || '上下文获取失败', 'error', '接口错误');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Select = fetch node detail + paint selected style
  // ──────────────────────────────────────────────────────────────────────────
  async function selectNode(id) {
    if (!id) { clearSelection(); return; }
    state.selectedId = id;
    if (state.cy) {
      state.cy.elements().removeClass('selected');
      const n = state.cy.getElementById(id);
      if (n && n.length) n.addClass('selected');
    }
    try {
      const data = await apiFetch('/api/node/' + encodeURIComponent(id));
      populateDetail(data);
    } catch (err) {
      showToast(err.message || '节点详情获取失败', 'error', '接口错误');
    }
  }

  function clearSelection() {
    state.selectedId = null;
    if (state.cy) state.cy.elements().removeClass('selected');
    $('#detail').hidden = true;
    $('#detail-empty').hidden = false;
  }

  function renderDetailEmpty() {
    const empty = $('#detail-empty');
    const stats = $('#detail-empty-stats');
    const list = $('#detail-quick-entries');
    if (!empty || !stats || !list) return;
    const s = state.status || {};
    stats.querySelector('[data-stat="files"] .num').textContent = fmtNum(s.fileCount);
    stats.querySelector('[data-stat="nodes"] .num').textContent = fmtNum(s.nodeCount);
    stats.querySelector('[data-stat="edges"] .num').textContent = fmtNum(s.edgeCount);
    clear(list);
    const overviewNodes = (state.overview && state.overview.nodes) || [];
    const role = (node) => {
      if (state.mode === 'springcloud') return getNodeRole(node);
      return node.kind;
    };
    const order = state.mode === 'springcloud'
      ? ['Controller', 'ServiceImpl', 'Service', 'Mapper', 'FeignClient', 'Config', 'Entity', 'App']
      : ['class', 'interface', 'function', 'method'];
    const seen = new Set();
    const picks = [];
    for (const want of order) {
      for (const n of overviewNodes) {
        if (picks.length >= 6) break;
        if (seen.has(n.id)) continue;
        if (role(n) !== want) continue;
        seen.add(n.id);
        picks.push({ node: n, role: want });
      }
      if (picks.length >= 6) break;
    }
    if (picks.length === 0 && overviewNodes.length) {
      overviewNodes.slice(0, 4).forEach((n) => picks.push({ node: n, role: n.kind }));
    }
    if (picks.length === 0) {
      list.appendChild(el('div', 'detail-empty-list-empty', '加载概览后可点击这里快速查看节点。'));
      return;
    }
    for (const p of picks) {
      const meta = state.mode === 'springcloud' ? SC_ROLES[p.role] : null;
      const color = meta ? meta.color : (state.kinds && state.kinds.nodeKindColors && state.kinds.nodeKindColors[p.role]) || '#94a3b8';
      const glyph = meta ? meta.glyph : '◇';
      const btn = el('button', 'detail-empty-entry');
      btn.type = 'button';
      btn.title = `聚焦 ${p.node.name}`;
      const swatch = el('span', 'entry-glyph');
      swatch.textContent = glyph;
      swatch.style.background = color;
      const name = el('span', 'entry-name');
      name.textContent = p.node.name;
      const roleLbl = el('span', 'entry-role');
      roleLbl.textContent = meta ? meta.label : p.role;
      btn.appendChild(swatch);
      btn.appendChild(name);
      btn.appendChild(roleLbl);
      btn.addEventListener('click', () => {
        focusNode(p.node.id, { depth: 2, direction: 'both', incremental: false });
      });
      list.appendChild(btn);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Right panel population
  // ──────────────────────────────────────────────────────────────────────────
  function populateDetail(data) {
    $('#detail-empty').hidden = true;
    $('#detail').hidden = false;

    const node = data.node || {};
    $('#detail-kind').textContent = node.kind || '—';
    $('#detail-name').textContent = node.name || node.id || '—';

    const sigEl = $('#detail-sig');
    sigEl.textContent = node.signature || '';
    sigEl.title = node.signature || '';

    const locParts = [];
    if (node.filePath) locParts.push(node.filePath);
    if (node.startLine != null) {
      locParts.push(':' + node.startLine);
      if (node.endLine && node.endLine !== node.startLine) {
        locParts.push('–' + node.endLine);
      }
    }
    const locStr = locParts.join('') || '';
    const locEl = $('#detail-loc');
    locEl.textContent = locStr;
    locEl.title = locStr;

    const codeEl = $('#code-block');
    if (data.code) {
      codeEl.textContent = data.code;
    } else {
      clear(codeEl);
      const span = el('span', 'empty', '（暂无源码）');
      codeEl.appendChild(span);
    }

    renderRefList($('#callers-list'), data.callers || []);
    renderRefList($('#callees-list'), data.callees || []);
    $('#badge-callers').textContent = (data.callers || []).length;
    $('#badge-callees').textContent = (data.callees || []).length;

    renderMembers(node, data.children || [], data.ancestors || []);

    renderCallStack(node, data.callers || [], data.callees || []);

    renderArchitectureSection(node);
    populateTraceControls(node, data.callers || [], data.callees || []);
    loadImpactForNode(node);

    activateTab(state.selectedTab);
  }

  function renderArchitectureSection(node) {
    const section = $('#arch-section');
    const roleEl = $('#arch-role');
    const layerEl = $('#arch-layer');
    const evidenceEl = $('#arch-evidence');
    if (!section || !roleEl || !layerEl || !evidenceEl) return;
    clear(roleEl);
    clear(layerEl);
    clear(evidenceEl);
    const facet = state.facets[node.id] || node;
    if (!facet || (!facet.role && !facet.layer && !facet.module)) {
      evidenceEl.appendChild(el('div', 'arch-empty', '当前节点暂无架构分层或角色信息。'));
      return;
    }
    if (facet.role) {
      const roleChip = el('div', 'arch-role-chip', facet.role);
      roleChip.style.borderLeftColor = getNodeColor({ ...node, id: node.id });
      roleEl.appendChild(roleChip);
    }
    if (facet.layer) {
      const layerChip = el('div', 'arch-layer-chip', facet.layer);
      layerChip.style.borderLeftColor = LAYER_COLORS[facet.layer] || '#94a3b8';
      layerEl.appendChild(layerChip);
    }
    const details = [
      ['模块', facet.module || getNodeModule(node) || '—'],
      ['置信度', `${Math.round(((facet.confidence || 0) * 100))}%`],
      ['入口点', facet.isEntrypoint ? '是' : '否'],
    ];
    details.forEach(([label, value]) => {
      const item = el('div', 'evidence-item');
      item.appendChild(el('div', 'evidence-name', label));
      item.appendChild(el('div', 'evidence-score', value));
      evidenceEl.appendChild(item);
    });
    const evidence = Array.isArray(facet.evidence) ? facet.evidence : [];
    evidence.forEach((line) => {
      const item = el('div', 'evidence-item');
      item.appendChild(el('div', 'evidence-score', line));
      evidenceEl.appendChild(item);
    });
  }

  function populateTraceControls(node, callers, callees) {
    const fromEl = $('#trace-from');
    const toEl = $('#trace-to');
    if (!fromEl || !toEl) return;
    clear(fromEl);
    clear(toEl);
    const candidates = [];
    const seen = new Set();
    [node].concat(callers.map((x) => x.node), callees.map((x) => x.node)).forEach((candidate) => {
      if (!candidate || seen.has(candidate.id)) return;
      seen.add(candidate.id);
      candidates.push(candidate);
    });
    candidates.forEach((candidate) => {
      const optFrom = document.createElement('option');
      optFrom.value = candidate.id;
      optFrom.textContent = candidate.name || candidate.id;
      fromEl.appendChild(optFrom);
      const optTo = document.createElement('option');
      optTo.value = candidate.id;
      optTo.textContent = candidate.name || candidate.id;
      toEl.appendChild(optTo);
    });
    fromEl.value = node.id;
    toEl.value = callees[0] && callees[0].node ? callees[0].node.id : node.id;
    loadTraceForSelection();
  }

  async function loadTraceForSelection() {
    const fromEl = $('#trace-from');
    const toEl = $('#trace-to');
    const summary = $('#trace-summary');
    const pathWrap = $('#trace-path');
    if (!fromEl || !toEl || !summary || !pathWrap) return;
    const from = fromEl.value;
    const to = toEl.value;
    clear(pathWrap);
    if (!from || !to) {
      summary.textContent = '请选择调用链起点和终点。';
      return;
    }
    summary.textContent = '调用链加载中…';
    try {
      const data = await apiFetch(`/api/architecture/trace?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      state.selectedTrace = data;
      summary.textContent = `路径置信度 ${Math.round((data.confidence || 0) * 100)}%${(data.warnings || []).length ? ' · 含提示' : ''}`;
      const hops = data.paths && data.paths[0] ? data.paths[0] : [];
      if (!hops.length) {
        pathWrap.appendChild(el('div', 'trace-edge', '未找到调用路径。'));
        return;
      }
      hops.forEach((hop, index) => {
        const nodeItem = el('div', 'trace-node');
        nodeItem.textContent = `${index + 1}. ${hop.node?.name || hop.node?.id || '—'}${hop.node?.role ? ` · ${hop.node.role}` : ''}`;
        pathWrap.appendChild(nodeItem);
        if (hop.edge) {
          const edgeItem = el('div', 'trace-edge');
          edgeItem.textContent = `${hop.edge.kind}${hop.edge.provenance ? ` · ${hop.edge.provenance}` : ''} · 置信度 ${Math.round((hop.confidence || 0) * 100)}%`;
          pathWrap.appendChild(edgeItem);
        }
      });
    } catch (err) {
      summary.textContent = '调用链加载失败';
      pathWrap.appendChild(el('div', 'trace-edge', err.message || '调用链加载失败'));
    }
  }

  async function loadImpactForNode(node) {
    const summary = $('#impact-summary');
    const list = $('#impact-risk-list');
    if (!summary || !list || !node || !node.id) return;
    clear(list);
    summary.textContent = '影响分析加载中…';
    try {
      const params = new URLSearchParams({ nodeId: node.id, depth: '3' });
      appendFilterParams(params);
      const data = await apiFetch('/api/architecture/impact?' + params.toString());
      state.selectedImpact = data;
      summary.textContent = `风险等级：${data.riskLevel || 'low'} · 影响节点 ${data.impact?.nodes?.length || 0} 个`;
      Object.entries(data.breakdown || {}).forEach(([key, value]) => {
        const item = el('div', `impact-risk-${data.riskLevel || 'low'}`);
        item.textContent = `${key} · ${value}`;
        list.appendChild(item);
      });
      (data.recommendedTests || []).forEach((text) => {
        const item = el('div', `impact-risk-${data.riskLevel || 'low'}`);
        item.textContent = `建议验证：${text}`;
        list.appendChild(item);
      });
    } catch (err) {
      summary.textContent = '影响分析加载失败';
      list.appendChild(el('div', 'impact-risk-low', err.message || '影响分析加载失败'));
    }
  }

  const MEMBER_GLYPHS = { method: 'M', function: 'F', field: '∇', property: '∇', constant: '#', enum_member: 'E', variable: '∇', parameter: 'P', import: '↘', export: '↗', class: 'C', interface: 'I', struct: 'S', trait: 'T' };
  const MEMBER_ORDER = ['method', 'function', 'field', 'property', 'constant', 'enum_member', 'variable', 'class', 'interface', 'struct', 'trait', 'parameter', 'import', 'export'];
  const MEMBER_LABELS = { method: '方法', function: '函数', field: '字段', property: '属性', constant: '常量', enum_member: '枚举值', variable: '变量', class: '内部类', interface: '内部接口', struct: '结构体', trait: '特质', parameter: '参数', import: '导入', export: '导出' };

  function renderMembers(node, children, ancestors) {
    const list = $('#members-list');
    const badge = $('#badge-members');
    if (!list || !badge) return;
    clear(list);
    if (!children.length) {
      list.appendChild(el('div', 'member-empty', '没有子成员（class 自身不包含任何 method/field/constant）。'));
      badge.textContent = '0';
      return;
    }
    badge.textContent = String(children.length);
    const parentScRole = state.mode === 'springcloud' ? getNodeRole(node) : null;
    const grouped = new Map();
    for (const c of children) {
      const k = c.kind || 'other';
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(c);
    }
    const order = MEMBER_ORDER.filter((k) => grouped.has(k));
    for (const k of Object.keys(grouped)) if (!order.includes(k)) order.push(k);
    for (const kind of order) {
      const items = grouped.get(kind).sort((a, b) => {
        const la = a.startLine || 0;
        const lb = b.startLine || 0;
        if (la !== lb) return la - lb;
        return (a.name || '').localeCompare(b.name || '');
      });
      const group = el('div', 'member-group');
      const label = el('div', 'member-group-label', `${MEMBER_LABELS[kind] || kind} · ${items.length}`);
      group.appendChild(label);
      for (const c of items) {
        group.appendChild(buildMemberRow(c, parentScRole));
      }
      list.appendChild(group);
    }
  }

  function buildMemberRow(c, parentScRole) {
    const kindColors = (state.kinds && state.kinds.nodeKindColors) || {};
    const color = kindColors[c.kind] || '#94a3b8';
    const row = el('div', 'member-item');
    row.title = (c.signature || c.name || '') + (c.filePath ? '\n' + c.filePath + (c.startLine != null ? ':' + c.startLine : '') : '');
    const glyph = el('span', 'mi-glyph');
    glyph.textContent = MEMBER_GLYPHS[c.kind] || '◇';
    glyph.style.background = color;
    row.appendChild(glyph);
    const name = el('span', 'mi-name', c.name || c.id);
    row.appendChild(name);
    if (c.signature) {
      const sig = el('span', 'mi-sig');
      sig.textContent = c.signature.length > 40 ? c.signature.slice(0, 40) + '…' : c.signature;
      row.appendChild(sig);
    }
    if (c.startLine != null) {
      const loc = el('span', 'mi-loc', ':' + c.startLine);
      row.appendChild(loc);
    }
    row.addEventListener('click', () => focusNode(c.id, { depth: 1, direction: 'both', incremental: false }));
    return row;
  }

  function renderCallStack(node, callers, callees) {
    const current = $('#stack-current');
    const upList = $('#stack-up-list');
    const downList = $('#stack-down-list');
    const badge = $('#badge-stack');
    if (!current || !upList || !downList) return;
    clear(current);
    clear(upList);
    clear(downList);
    const name = el('div', 'cs-name', node.name || node.id || '—');
    current.appendChild(name);
    const locBits = [];
    if (node.filePath) locBits.push(node.filePath);
    if (node.startLine != null) locBits.push(':' + node.startLine);
    const meta = el('div', 'cs-meta', (locBits.join('') || '—') + ' · ' + (node.kind || ''));
    current.appendChild(meta);

    const scRole = state.mode === 'springcloud' ? getNodeRole(node) : null;
    const scMeta = scRole ? SC_ROLES[scRole] : null;
    if (scMeta) {
      const role = el('div', 'cs-meta');
      role.textContent = 'Spring Cloud 角色：' + scMeta.label;
      current.appendChild(role);
    }

    if (!callers.length) {
      upList.appendChild(el('li', 'call-tree-empty', '没有上游调用（可能是入口）'));
    } else {
      callers.slice(0, 12).forEach((ref) => {
        if (!ref || !ref.node) return;
        upList.appendChild(buildCallStackRow(ref.node, ref.edge));
      });
      if (callers.length > 12) {
        upList.appendChild(el('li', 'call-tree-empty', `…还有 ${callers.length - 12} 个调用方`));
      }
    }
    if (!callees.length) {
      downList.appendChild(el('li', 'call-tree-empty', '没有下游调用（叶子节点）'));
    } else {
      callees.slice(0, 12).forEach((ref) => {
        if (!ref || !ref.node) return;
        downList.appendChild(buildCallStackRow(ref.node, ref.edge));
      });
      if (callees.length > 12) {
        downList.appendChild(el('li', 'call-tree-empty', `…还有 ${callees.length - 12} 个被调用`));
      }
    }
    badge.textContent = (callers.length + callees.length) > 0
      ? (callers.length + '↑ / ' + callees.length + '↓')
      : '0';
  }

  function buildCallStackRow(n, edge) {
    const li = el('li', 'call-tree-item');
    const dot = el('span', 'ct-dot');
    let color = edge && edge.color;
    if (!color && state.mode === 'springcloud') {
      const role = getNodeRole(n);
      if (role && SC_ROLES[role]) color = SC_ROLES[role].color;
    }
    if (!color && state.kinds && state.kinds.nodeKindColors) {
      color = state.kinds.nodeKindColors[n.kind] || '#94a3b8';
    }
    dot.style.background = color || '#94a3b8';
    li.appendChild(dot);
    li.appendChild(el('span', 'ct-name', n.name || n.id));
    const bits = [];
    if (n.kind) bits.push(n.kind);
    if (state.mode === 'springcloud') {
      const r = getNodeRole(n);
      if (r) bits.push(r);
    }
    if (n.filePath) {
      const short = n.filePath.split('/').slice(-2).join('/');
      bits.push(short);
    }
    if (n.startLine != null) bits.push(':' + n.startLine);
    li.appendChild(el('span', 'ct-loc', bits.join(' · ')));
    li.title = bits.join(' · ');
    li.addEventListener('click', () => focusNode(n.id, { depth: 2, direction: 'both', incremental: false }));
    return li;
  }

  function renderRefList(target, refs) {
    clear(target);
    if (!refs.length) {
      target.appendChild(el('li', 'ref-empty', '没有引用。'));
      return;
    }
    const frag = document.createDocumentFragment();
    refs.forEach((ref) => {
      if (!ref || !ref.node) return;
      const n = ref.node;
      const edge = ref.edge || {};
      const li = el('li', 'ref-item');
      const dot = el('span', 'ref-dot');
      dot.style.background = edge.color || n.color || '#94a3b8';
      li.appendChild(dot);
      const txt = el('div', 'ref-text');
      txt.appendChild(el('div', 'ref-name', n.name || n.id));
      const locBits = [];
      if (edge.kind) locBits.push(edge.kind + ' · ');
      if (n.filePath) locBits.push(n.filePath);
      if (n.startLine != null) locBits.push(':' + n.startLine);
      txt.appendChild(el('div', 'ref-loc', locBits.join('') || '—'));
      li.appendChild(txt);
      li.addEventListener('click', () => focusNode(n.id));
      frag.appendChild(li);
    });
    target.appendChild(frag);
  }

  function activateTab(name) {
    state.selectedTab = name;
    $$('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Top-level event wiring
  // ──────────────────────────────────────────────────────────────────────────
  function wireEvents() {
    $('#project-form').addEventListener('submit', (e) => {
      e.preventDefault();
      switchProject($('#project-path').value);
    });

    $('#btn-project-browse').addEventListener('click', openBrowseModal);
    $('#btn-browse-close').addEventListener('click', closeBrowseModal);
    $('#btn-browse-parent').addEventListener('click', () => {
      if (state.browseParent) browseTo(state.browseParent);
    });
    $('#btn-browse-roots').addEventListener('click', () => browseTo('__roots__'));
    $('#btn-browse-select-current').addEventListener('click', () => {
      if (!state.browsePath) return;
      $('#project-path').value = state.browsePath;
      closeBrowseModal();
      switchProject(state.browsePath);
    });
    $('#browse-modal').addEventListener('click', (e) => {
      if (e.target.id === 'browse-modal') closeBrowseModal();
    });

    $('#search-input').addEventListener('input', (e) => debouncedSearch(e.target.value));
    $('#search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideSuggestions();
        e.target.value = '';
        runSearch('');
        e.target.blur();
        return;
      }
      const suggest = $('#search-suggestions');
      if (!suggest || suggest.hidden) return;
      const items = $$('#search-suggestions .result');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightSuggestion(state.suggestionIdx < 0 ? 0 : Math.min(items.length - 1, state.suggestionIdx + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightSuggestion(state.suggestionIdx < 0 ? items.length - 1 : Math.max(0, state.suggestionIdx - 1));
      } else if (e.key === 'Enter') {
        if (state.suggestionIdx >= 0 && items[state.suggestionIdx]) {
          e.preventDefault();
          items[state.suggestionIdx].click();
        }
      }
    });

    // Click outside the search input wrap closes the suggestions dropdown.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-input-wrap')) hideSuggestions();
    });
    // Reposition the fixed dropdown on scroll/resize so it stays under the input.
    const repositionIfOpen = () => {
      const s = $('#search-suggestions');
      if (s && !s.hidden) positionSuggestions();
    };
    window.addEventListener('scroll', repositionIfOpen, { passive: true });
    window.addEventListener('resize', repositionIfOpen);
    document.addEventListener('scroll', repositionIfOpen, { passive: true, capture: true });

    // Filter section collapse/expand — per-section state persisted in localStorage
    // so the user's preferred panel layout survives reloads.
    const FILTER_COLLAPSED_KEY = 'springgraph-filter-collapsed';
    function getFilterCollapsed() {
      try { return JSON.parse(localStorage.getItem(FILTER_COLLAPSED_KEY) || '{}'); } catch { return {}; }
    }
    function saveFilterCollapsed(id, collapsed) {
      const state = getFilterCollapsed();
      if (collapsed) state[id] = true; else delete state[id];
      try { localStorage.setItem(FILTER_COLLAPSED_KEY, JSON.stringify(state)); } catch {}
    }
    const _collapsedState = getFilterCollapsed();
    $$('.filter-section-label').forEach((label) => {
      const section = label.closest('.filter-section');
      if (!section) return;
      if (_collapsedState[section.id]) {
        section.classList.add('collapsed');
        label.setAttribute('aria-expanded', 'false');
      }
      label.addEventListener('click', () => {
        const isCollapsed = section.classList.toggle('collapsed');
        label.setAttribute('aria-expanded', String(!isCollapsed));
        saveFilterCollapsed(section.id, isCollapsed);
      });
    });

    $('#color-by-select').addEventListener('change', (e) => {
      state.colorBy = e.target.value;
      if (state.cy) {
        state.cy.nodes().forEach((n) => {
          n.style('background-color', getNodeColor(n.data()));
          n.style('border-color', getNodeColor(n.data()));
        });
      }
    });

    $('#layout-select').addEventListener('change', (e) => {
      state.layoutName = e.target.value;
      if (state.cy) state.cy.layout(layoutOpts(state.layoutName)).run();
    });

    $('#btn-reset').addEventListener('click', () => {
      state.focusId = null;
      state.selectedId = null;
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      $('#empty-state').hidden = true;
      $('#no-conn-msg').hidden = true;
      $('#canvas-meta').textContent = '';
      clearSelection();
      const input = $('#search-input');
      input.value = '';
      runSearch('');
      loadOverview();
      input.focus();
    });

    $('#btn-refresh').addEventListener('click', async () => {
      await refreshStats();
      if (state.focusId) {
        try {
          focusNode(state.focusId, { depth: DEFAULT_DEPTH, direction: 'both', incremental: false });
        } catch (_) { /* toast already shown */ }
      } else {
        loadOverview();
      }
    });

    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    $('#btn-expand').addEventListener('click', () => {
      if (!state.focusId) {
        showToast('尚未聚焦节点。', 'warn');
        return;
      }
      focusNode(state.focusId, { depth: EXPAND_DEPTH, incremental: true });
    });

    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => activateTab(t.dataset.tab));
    });

    $$('.mode-btn').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });

    const edgeChips = $('#edge-type-chips');
    if (edgeChips) {
      edgeChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.edge-chip');
        if (!chip) return;
        const kind = chip.dataset.edge;
        if (state.activeEdgeFilters.has(kind)) {
          state.activeEdgeFilters.delete(kind);
          chip.classList.add('muted');
        } else {
          state.activeEdgeFilters.add(kind);
          chip.classList.remove('muted');
        }
        applyFiltersToCy();
      });
    }

    const roleChips = $('#role-chips');
    if (roleChips) {
      roleChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.role-chip');
        if (!chip) return;
        const role = chip.dataset.role;
        if (state.activeRoleFilters.has(role)) {
          state.activeRoleFilters.delete(role);
          chip.classList.remove('active');
        } else {
          state.activeRoleFilters.add(role);
          chip.classList.add('active');
        }
        loadOverview();
      });
    }

    const layerChips = $('#layer-chips');
    if (layerChips) {
      layerChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.layer-chip');
        if (!chip) return;
        const layer = chip.dataset.layer;
        if (state.activeLayerFilters.has(layer)) {
          state.activeLayerFilters.delete(layer);
          chip.classList.remove('active');
        } else {
          state.activeLayerFilters.add(layer);
          chip.classList.add('active');
        }
        loadOverview();
      });
    }

    const moduleChips = $('#module-chips');
    if (moduleChips) {
      moduleChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.module-chip');
        if (!chip) return;
        const moduleName = chip.dataset.module;
        if (state.selectedModules.has(moduleName)) {
          state.selectedModules.delete(moduleName);
          chip.classList.remove('active');
        } else {
          state.selectedModules.add(moduleName);
          chip.classList.add('active');
        }
        if (state.focusId) {
          focusNode(state.focusId, { depth: DEFAULT_DEPTH, direction: 'both', incremental: false });
        } else {
          loadOverview();
        }
      });
    }

    const labelToggle = $('#btn-edge-labels-toggle');
    if (labelToggle) {
      labelToggle.addEventListener('click', () => {
        state.showEdgeLabels = !state.showEdgeLabels;
        labelToggle.textContent = state.showEdgeLabels ? '标签 · 开' : '标签 · 关';
        rebuildCurrentView();
      });
    }

    const evidenceBtn = $('#btn-evidence');
    if (evidenceBtn) evidenceBtn.addEventListener('click', openEvidenceModal);
    const evidenceClose = $('#btn-evidence-close');
    if (evidenceClose) evidenceClose.addEventListener('click', closeEvidenceModal);
    const evidenceModal = $('#evidence-modal');
    if (evidenceModal) {
      evidenceModal.addEventListener('click', (e) => {
        if (e.target.id === 'evidence-modal') closeEvidenceModal();
      });
    }

    const traceRun = $('#btn-trace-run');
    if (traceRun) traceRun.addEventListener('click', () => loadTraceForSelection());

    // MCP Playground wiring
    const pgBtn = $('#btn-mcp-playground');
    if (pgBtn) pgBtn.addEventListener('click', openPlaygroundModal);
    const pgClose = $('#btn-mcp-playground-close');
    if (pgClose) pgClose.addEventListener('click', closePlaygroundModal);
    const pgModal = $('#mcp-playground-modal');
    if (pgModal) {
      pgModal.addEventListener('click', (e) => {
        if (e.target.id === 'mcp-playground-modal') closePlaygroundModal();
      });
    }
    const pgInvoke = $('#btn-pg-invoke');
    if (pgInvoke) pgInvoke.addEventListener('click', invokePlaygroundTool);
    const pgToggleRaw = $('#btn-pg-toggle-raw');
    if (pgToggleRaw) {
      pgToggleRaw.hidden = false;
      pgToggleRaw.addEventListener('click', () => setPlaygroundRawMode(!state.pgRawMode));
    }
    const pgFill = $('#btn-pg-fill-example');
    if (pgFill) pgFill.addEventListener('click', fillPlaygroundExample);
    const pgForm = $('#pg-form');
    if (pgForm) {
      pgForm.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          invokePlaygroundTool();
        }
      });
    }
    const pgJson = $('#pg-json-input');
    if (pgJson) {
      pgJson.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          invokePlaygroundTool();
        }
      });
    }

    // Escape clears the tooltip if it's stuck.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      $('#tooltip').hidden = true;
      const pgm = $('#mcp-playground-modal');
      if (pgm && !pgm.hidden) closePlaygroundModal();
    });

    // Resize: cytoscape auto-fits, but a manual resize() helps in some browsers.
    let resizeT = null;
    window.addEventListener('resize', () => {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(() => { if (state.cy) state.cy.resize(); }, 120);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MCP Playground — invokes MCP tools via /api/mcp/invoke. Renders a
  // dynamic form from each tool's inputSchema (string/number/boolean/enum
  // map to native controls; object/array map to JSON textareas so the
  // user can paste any shape), shows the raw ToolResult below. Schema is
  // loaded once per modal open and cached on state.
  // ──────────────────────────────────────────────────────────────────────────
  const PG_EXAMPLES = {
    springgraph_search:    { query: 'UserService', limit: 10 },
    springgraph_explore:   { query: 'UserService login', maxFiles: 8 },
    springgraph_node:      { symbol: 'UserService', includeCode: true },
    springgraph_callers:   { symbol: 'UserService', limit: 20 },
    springgraph_callees:   { symbol: 'UserService', limit: 20 },
    springgraph_impact:    { symbol: 'UserService', depth: 2 },
    springgraph_files:     { format: 'grouped', maxDepth: 3 },
    springgraph_status:    {},
  };

  // 中文翻译表 — MCP 工具的描述和参数描述来自英文 schema，
  // 在 playground 中展示给中文用户时优先使用这里的本地化文本。
  // 缺失时回退到原文，不会影响真实 MCP 协议输出。
  const PG_TRANSLATIONS = {
    tools: {
      springgraph_search: '按名称快速搜索符号。仅返回位置（不含源码）。如需查看源码或理解一片区域，请改用 springgraph_explore。',
      springgraph_callers: '列出调用 <symbol> 的所有函数。查看完整调用流程请用 springgraph_explore。',
      springgraph_callees: '列出 <symbol> 调用的所有函数。查看完整调用流程请用 springgraph_explore。',
      springgraph_impact: '列出修改 <symbol> 后会受影响的符号。重构前使用。',
      springgraph_node: '两种模式。(1) 像 Read 一样读文件：传 file（路径或文件名）而不传 symbol，返回该文件当前磁盘上的完整源码（带行号，与 Read 工具输出一致），可用 offset/limit 收窄范围 — 同时附一行说明哪些文件依赖它。字节内容与 Read 一致，但来自索引更快，且附带影响范围。(2) 读取一个能命名的符号：位置、签名、完整源码（includeCode=true）和调用方/被调用方轨迹，一次返回。对于有歧义的名称，会在一次调用中返回所有重载的源码（这样你不必为了找对重载而 Read 文件）；传 file/line 来精确定位。多个相关符号或完整流程请用 springgraph_explore。',
      springgraph_explore: '首选工具 — 几乎所有问题的首次调用，包括「X 是怎么工作的」、架构、bug、X 在哪里、调查一片区域，或即将修改的符号。一次返回相关符号的完整源码（按文件分组），并在符号之间画出调用路径。查询可以是自然语言问题，也可以是符号/文件名列表。',
      springgraph_status: '索引健康检查（文件 / 节点 / 边）。除非调试，否则跳过。',
      springgraph_files: '已索引的文件树，附语言和符号计数。比 Glob 更快地展示项目结构。',
    },
    params: {
      springgraph_search: {
        query: '符号名称或部分名称（例如：「auth」、「signIn」、「UserService」）',
        kind: '按节点类型筛选',
        limit: '最大结果数（默认：10）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。用于跨代码库查询。',
      },
      springgraph_explore: {
        query: '要探索的符号名、文件名或简短的代码术语（例如：「AuthService loginUser session-manager」、「GraphTraverser BFS impact traversal.ts」）。对于流程问题，列出贯穿该流程的符号（例如「mutateElement renderScene」）。自然语言问题也可以 — 无需先调用 springgraph_search。',
        maxFiles: '包含源码的最大文件数（默认：12）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_node: {
        symbol: '要读取的符号名称（符号模式）。省略此参数并单独传 file 即可像 Read 工具一样读整个文件。',
        includeCode: '符号模式：是否包含符号的完整函数体（默认：false）。文件模式下忽略；除非设置 symbolsOnly，否则始终返回源码。',
        file: '文件路径或文件名（例如「harness.rs」、「src/auth/session.ts」）。单独传它（不传 symbol）即可像 Read 工具一样读取文件 — 返回带行号的完整源码 + 哪些文件依赖它。或与 symbol 一起传，用于在多个同名符号中精确定位到该文件中的定义。',
        offset: '文件模式：1-based 起始行号，与 Read 的 offset 一致。默认从文件开头开始。',
        limit: '文件模式：返回的最大行数，与 Read 的 limit 一致。默认返回整个文件（最多 2000 行，与 Read 一致）。',
        symbolsOnly: '文件模式：仅返回文件的符号地图和依赖项（轻量结构概览），不返回源码。',
        line: '仅符号模式：精确定位到该行附近的定义（与 trail 给出的 file:line 一起使用）。',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_callers: {
        symbol: '要查找调用方的函数、方法或类的名称',
        file: '当存在多个同名符号时（例如 monorepo 中每个 app 都有一个 UserService），限定到该文件中的定义（路径或后缀）',
        limit: '最大返回调用方数（默认：20）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_callees: {
        symbol: '要查找被调用方的函数、方法或类的名称',
        file: '当存在多个同名符号时，限定到该文件中的定义（路径或后缀）',
        limit: '最大返回被调用方数（默认：20）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_impact: {
        symbol: '要分析影响范围的符号名称',
        file: '当存在多个同名符号时，限定到该文件中的定义（路径或后缀）',
        depth: '遍历依赖的层数（默认：2）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_files: {
        path: '筛选该目录下的文件（例如「src/components」）。不指定则返回所有文件。',
        pattern: '匹配该 glob 模式的文件（例如「*.tsx」、「**/*.test.ts」）',
        format: '输出格式：「tree」（层级结构，默认）、「flat」（简单列表）、「grouped」（按语言分组）',
        includeMetadata: '是否包含文件元数据，如语言和符号计数（默认：true）',
        maxDepth: '最大目录深度（默认：无限制）',
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
      springgraph_status: {
        projectPath: '其他项目的路径（需已初始化 .springgraph/）。省略则使用当前项目。',
      },
    },
    enumLabels: {
      kind: {
        function: 'function · 函数',
        method: 'method · 方法',
        class: 'class · 类',
        interface: 'interface · 接口',
        type: 'type · 类型',
        variable: 'variable · 变量',
        route: 'route · 路由',
        component: 'component · 组件',
      },
      format: {
        tree: 'tree · 层级结构',
        flat: 'flat · 简单列表',
        grouped: 'grouped · 按语言分组',
      },
    },
  };

  function trTool(name) {
    return (PG_TRANSLATIONS.tools && PG_TRANSLATIONS.tools[name]) || null;
  }
  function trParam(toolName, paramName) {
    const map = PG_TRANSLATIONS.params && PG_TRANSLATIONS.params[toolName];
    return (map && map[paramName]) || null;
  }
  function trEnum(toolName, paramName, value) {
    const map = PG_TRANSLATIONS.enumLabels && PG_TRANSLATIONS.enumLabels[paramName];
    return (map && map[value]) || null;
  }

  function openPlaygroundModal() {
    const modal = $('#mcp-playground-modal');
    if (!modal) return;
    modal.hidden = false;
    if (state.pgTools == null) {
      loadMcpTools();
    } else if (state.pgSelectedTool) {
      // Re-render form in case the active project changed under us.
      selectPlaygroundTool(state.pgSelectedTool.name, { keepResponse: true });
    }
  }

  function closePlaygroundModal() {
    const modal = $('#mcp-playground-modal');
    if (modal) modal.hidden = true;
  }

  async function loadMcpTools() {
    const listEl = $('#pg-tools-list');
    if (!listEl) return;
    listEl.innerHTML = '<li class="pg-tool-empty">加载中…</li>';
    try {
      const data = await apiFetch('/api/mcp/tools');
      state.pgTools = (data && data.tools) || [];
      renderPlaygroundToolList();
      if (state.pgTools.length > 0) {
        // Default to the first tool so the user sees a form immediately.
        const preferred = state.pgTools.find((t) => t.name === 'springgraph_search') || state.pgTools[0];
        selectPlaygroundTool(preferred.name, { keepResponse: false });
      } else {
        clearPlaygroundForm();
        $('#pg-tool-name').textContent = '—';
        $('#pg-tool-desc').textContent = '当前没有可用的 MCP 工具。';
      }
    } catch (err) {
      listEl.innerHTML = '<li class="pg-tool-empty">工具列表加载失败：' + escapeHtml(err.message || String(err)) + '</li>';
      clearPlaygroundForm();
      $('#pg-tool-name').textContent = '—';
      $('#pg-tool-desc').textContent = '请稍后重试。';
    }
  }

  function renderPlaygroundToolList() {
    const listEl = $('#pg-tools-list');
    if (!listEl) return;
    clear(listEl);
    const tools = state.pgTools || [];
    if (tools.length === 0) {
      listEl.appendChild(el('li', 'pg-tool-empty', '当前没有可用的 MCP 工具。'));
      return;
    }
    tools.forEach((tool) => {
      const li = el('li', 'pg-tool-item');
      li.dataset.tool = tool.name;
      li.textContent = tool.name;
      li.title = trTool(tool.name) || tool.description || tool.name;
      li.setAttribute('role', 'option');
      if (state.pgSelectedTool && state.pgSelectedTool.name === tool.name) {
        li.classList.add('active');
        li.setAttribute('aria-selected', 'true');
      } else {
        li.setAttribute('aria-selected', 'false');
      }
      li.addEventListener('click', () => selectPlaygroundTool(tool.name, { keepResponse: false }));
      listEl.appendChild(li);
    });
  }

  function selectPlaygroundTool(name, opts) {
    opts = opts || {};
    const tools = state.pgTools || [];
    const tool = tools.find((t) => t.name === name);
    if (!tool) return;
    state.pgSelectedTool = tool;
    state.pgRawMode = false;
    $$('#pg-tools-list .pg-tool-item').forEach((li) => {
      const isActive = li.dataset.tool === name;
      li.classList.toggle('active', isActive);
      li.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    $('#pg-tool-name').textContent = tool.name;
    $('#pg-tool-desc').textContent = trTool(tool.name) || tool.description || '';
    renderPlaygroundForm(tool);
    setPlaygroundRawMode(false);
    const invokeBtn = $('#btn-pg-invoke');
    if (invokeBtn) invokeBtn.disabled = false;
    if (!opts.keepResponse) {
      const statusEl = $('#pg-response-status');
      const bodyEl = $('#pg-response-body');
      if (statusEl) { statusEl.textContent = '—'; statusEl.className = 'pg-response-status'; }
      if (bodyEl) {
        bodyEl.className = 'pg-response-body mono';
        bodyEl.textContent = '点击「调用」发起一次 MCP 工具调用。';
      }
    }
  }

  function clearPlaygroundForm() {
    const form = $('#pg-form');
    if (form) clear(form);
    const json = $('#pg-json-input');
    if (json) json.value = '';
    const invokeBtn = $('#btn-pg-invoke');
    if (invokeBtn) invokeBtn.disabled = true;
  }

  // Render a form for the given tool's inputSchema. Properties is a map of
  // name -> { type, description, enum?, default? }. The "type" string is
  // the JSON Schema type (string/number/boolean/integer/array/object).
  function renderPlaygroundForm(tool) {
    const form = $('#pg-form');
    const json = $('#pg-json-input');
    if (!form) return;
    clear(form);
    const schema = (tool && tool.inputSchema) || {};
    const properties = (schema && schema.properties) || {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const propNames = Object.keys(properties);
    if (propNames.length === 0) {
      const empty = el('div', 'pg-form-empty', '该工具无需参数。');
      form.appendChild(empty);
      if (json) json.value = '{}';
      return;
    }
    const example = PG_EXAMPLES[tool.name] || {};
    propNames.forEach((name) => {
      const prop = properties[name] || {};
      const type = (prop.type || 'string').toLowerCase();
      const isRequired = required.indexOf(name) !== -1;
      const label = el('label', 'pg-field');
      label.dataset.field = name;
      const head = el('div', 'pg-field-name');
      head.appendChild(document.createTextNode(name));
      if (isRequired) {
        const star = el('span', 'pg-required', '*');
        star.title = '必填';
        head.appendChild(star);
      }
      const typeBadge = el('span', 'pg-field-type', type);
      head.appendChild(typeBadge);
      label.appendChild(head);
      if (prop.description || trParam(tool.name, name)) {
        label.appendChild(el('div', 'pg-field-desc', trParam(tool.name, name) || prop.description));
      }
      const exampleVal = Object.prototype.hasOwnProperty.call(example, name) ? example[name] : prop.default;
      const input = buildPlaygroundInput(tool.name, name, type, prop, exampleVal);
      label.appendChild(input);
      form.appendChild(label);
    });
    if (json) {
      try {
        json.value = JSON.stringify(example, null, 2);
      } catch (_) {
        json.value = '{}';
      }
    }
  }

  // Build a single form control. Enum-valued strings get a <select>;
  // booleans get a checkbox; everything else falls through to a text/number
  // input. Object/array types get a small JSON editor (textarea) — easier
  // than walking arbitrary nested shapes.
  function buildPlaygroundInput(toolName, name, type, prop, exampleVal) {
    if (type === 'boolean') {
      const wrap = el('div', 'pg-field-row');
      const cb = el('input', 'pg-input-boolean');
      cb.type = 'checkbox';
      cb.name = name;
      cb.dataset.type = 'boolean';
      if (exampleVal === true) cb.checked = true;
      if (exampleVal === false) cb.checked = false;
      else if (prop.default === true) cb.checked = true;
      const text = el('span', 'pg-field-desc', '勾选 = true，不勾选 = false');
      wrap.appendChild(cb);
      wrap.appendChild(text);
      return wrap;
    }
    if (type === 'number' || type === 'integer') {
      const input = el('input');
      input.type = 'number';
      input.className = 'pg-input-number';
      input.name = name;
      input.dataset.type = type;
      if (typeof exampleVal === 'number') input.value = String(exampleVal);
      else if (typeof prop.default === 'number') input.value = String(prop.default);
      if (type === 'integer') input.step = '1';
      return input;
    }
    if (type === 'string' && Array.isArray(prop.enum) && prop.enum.length > 0) {
      const sel = el('select');
      sel.name = name;
      sel.dataset.type = 'string-enum';
      const blank = el('option', '', '');
      blank.value = '';
      blank.textContent = '（留空）';
      sel.appendChild(blank);
      prop.enum.forEach((v) => {
        const opt = el('option', '', trEnum(toolName, name, String(v)) || String(v));
        opt.value = String(v);
        sel.appendChild(opt);
      });
      if (exampleVal != null) sel.value = String(exampleVal);
      else if (prop.default != null) sel.value = String(prop.default);
      return sel;
    }
    if (type === 'object' || type === 'array') {
      const ta = el('textarea');
      ta.className = 'pg-input-json mono';
      ta.name = name;
      ta.dataset.type = type;
      ta.spellcheck = false;
      ta.rows = 3;
      try {
        ta.value = exampleVal != null
          ? JSON.stringify(exampleVal, null, 2)
          : (type === 'array' ? '[]' : '{}');
      } catch (_) {
        ta.value = type === 'array' ? '[]' : '{}';
      }
      return ta;
    }
    const input = el('input');
    input.type = 'text';
    input.className = 'pg-input-text';
    input.name = name;
    input.dataset.type = 'string';
    if (exampleVal != null) input.value = String(exampleVal);
    else if (prop.default != null) input.value = String(prop.default);
    return input;
  }

  // Read the form (or the JSON textarea in raw mode) back into an args
  // object suitable for /api/mcp/invoke. Returns { args, error } — error
  // is set when a JSON-shaped field is unparseable.
  function collectPlaygroundArgs() {
    if (!state.pgSelectedTool) return { args: {}, error: '未选择工具' };
    if (state.pgRawMode) {
      const raw = $('#pg-json-input').value.trim() || '{}';
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { args: {}, error: '顶层 JSON 必须是对象' };
        }
        return { args: parsed, error: null };
      } catch (err) {
        return { args: {}, error: 'JSON 解析失败：' + (err.message || err) };
      }
    }
    const form = $('#pg-form');
    if (!form) return { args: {}, error: '表单丢失' };
    const args = {};
    const inputs = form.querySelectorAll('[name]');
    for (const input of inputs) {
      const name = input.name;
      const dtype = input.dataset.type || 'string';
      if (dtype === 'boolean') {
        args[name] = !!input.checked;
        continue;
      }
      const raw = (input.value || '').trim();
      if (raw === '') continue; // optional empty fields stay absent.
      if (dtype === 'number' || dtype === 'integer') {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          return { args: {}, error: `参数 ${name} 不是合法数字` };
        }
        args[name] = n;
        continue;
      }
      if (dtype === 'object' || dtype === 'array') {
        try {
          args[name] = JSON.parse(raw);
        } catch (err) {
          return { args: {}, error: `参数 ${name} 不是合法 JSON：${err.message || err}` };
        }
        continue;
      }
      args[name] = raw;
    }
    return { args, error: null };
  }

  function setPlaygroundRawMode(enable) {
    state.pgRawMode = !!enable;
    const form = $('#pg-form');
    const json = $('#pg-json-input');
    const toggle = $('#btn-pg-toggle-raw');
    if (!form || !json) return;
    if (state.pgRawMode) {
      // Sync form → JSON before showing the textarea.
      const { args, error } = collectPlaygroundArgs();
      if (error) {
        showToast(error, 'warn');
      }
      json.value = JSON.stringify(args || {}, null, 2);
      form.style.display = 'none';
      json.hidden = false;
      if (toggle) toggle.textContent = '返回表单';
    } else {
      json.hidden = true;
      form.style.display = '';
      if (toggle) toggle.textContent = '切换 JSON';
    }
  }

  function fillPlaygroundExample() {
    if (!state.pgSelectedTool) return;
    const example = PG_EXAMPLES[state.pgSelectedTool.name];
    const json = $('#pg-json-input');
    if (state.pgRawMode) {
      json.value = JSON.stringify(example || {}, null, 2);
      return;
    }
    if (example) {
      renderPlaygroundForm(state.pgSelectedTool);
      return;
    }
    if (json) json.value = '{}';
  }

  async function invokePlaygroundTool() {
    if (!state.pgSelectedTool || state.pgInvoking) return;
    const { args, error } = collectPlaygroundArgs();
    const statusEl = $('#pg-response-status');
    const bodyEl = $('#pg-response-body');
    if (error) {
      if (statusEl) { statusEl.textContent = '参数错误'; statusEl.className = 'pg-response-status err'; }
      if (bodyEl) {
        bodyEl.className = 'pg-response-body mono err';
        bodyEl.textContent = error;
      }
      return;
    }
    const invokeBtn = $('#btn-pg-invoke');
    const spinner = invokeBtn ? invokeBtn.querySelector('.pg-invoke-spinner') : null;
    const label = invokeBtn ? invokeBtn.querySelector('.pg-invoke-label') : null;
    state.pgInvoking = true;
    if (invokeBtn) invokeBtn.disabled = true;
    if (spinner) spinner.classList.add('show');
    if (label) label.textContent = '调用中…';
    if (statusEl) { statusEl.textContent = '调用中…'; statusEl.className = 'pg-response-status'; }
    if (bodyEl) {
      bodyEl.className = 'pg-response-body mono';
      bodyEl.textContent = '等待响应…';
    }
    const started = performance.now();
    try {
      const result = await apiFetch('/api/mcp/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: state.pgSelectedTool.name, args }),
      });
      const elapsed = Math.max(0, Math.round(performance.now() - started));
      const isErr = !!result.isError;
      const text = extractToolText(result);
      if (statusEl) {
        statusEl.textContent = isErr ? `isError · ${elapsed}ms` : `OK · ${elapsed}ms`;
        statusEl.className = 'pg-response-status ' + (isErr ? 'err' : 'ok');
      }
      renderPlaygroundResponse(bodyEl, text, isErr);
    } catch (err) {
      const elapsed = Math.max(0, Math.round(performance.now() - started));
      if (statusEl) {
        statusEl.textContent = `HTTP 错误 · ${elapsed}ms`;
        statusEl.className = 'pg-response-status err';
      }
      if (bodyEl) {
        bodyEl.className = 'pg-response-body mono err';
        bodyEl.textContent = (err && err.message) ? err.message : String(err);
      }
    } finally {
      state.pgInvoking = false;
      if (invokeBtn) invokeBtn.disabled = false;
      if (spinner) spinner.classList.remove('show');
      if (label) label.textContent = '调用';
    }
  }

  // The MCP ToolResult is { content: [{type:'text', text:'…'}], isError? }.
  // We pull the joined text and try to JSON-pretty-print it; if it doesn't
  // parse as JSON, we show the raw text.
  function extractToolText(result) {
    if (!result || !Array.isArray(result.content)) return '';
    return result.content
      .map((c) => (c && typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  function renderPlaygroundResponse(bodyEl, text, isError) {
    if (!bodyEl) return;
    bodyEl.className = 'pg-response-body mono' + (isError ? ' err' : '');
    if (!text) {
      bodyEl.textContent = '（空响应）';
      return;
    }
    const blocks = splitCodeFences(text);
    clear(bodyEl);
    blocks.forEach((block) => {
      if (block.type === 'fence') {
        const pre = el('pre', 'pg-fence mono', block.text);
        pre.style.margin = '0';
        pre.style.whiteSpace = 'pre-wrap';
        bodyEl.appendChild(pre);
      } else {
        const span = el('span', 'pg-text');
        if (tryRenderJsonSpan(span, block.text)) {
          // JSON-pretty path: colored tokens injected into span.
        } else {
          span.textContent = block.text;
        }
        bodyEl.appendChild(span);
        bodyEl.appendChild(document.createTextNode('\n'));
      }
    });
  }

  // Split a string on triple-backtick fences, keeping the fences so the
  // response preserves the agent-style code-block structure.
  function splitCodeFences(text) {
    const out = [];
    const re = /```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(text)) != null) {
      if (match.index > lastIndex) {
        out.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }
      out.push({ type: 'fence', text: match[1] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) out.push({ type: 'text', text: text.slice(lastIndex) });
    return out;
  }

  // If `text` parses as JSON, render it with token-level colors. Returns
  // true on success. On parse failure the caller falls back to plain text.
  function tryRenderJsonSpan(span, text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return false;
    try {
      const obj = JSON.parse(trimmed);
      span.innerHTML = '';
      const formatted = JSON.stringify(obj, null, 2);
      appendJsonTokens(span, formatted);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Walk a pretty-printed JSON string and append colorized tokens.
  function appendJsonTokens(parent, json) {
    const re = /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],])/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(json)) != null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(json.slice(lastIndex, match.index)));
      }
      const tok = match[0];
      let cls = '';
      if (tok.endsWith(':')) cls = 'pg-json-key';
      else if (tok[0] === '"') cls = 'pg-json-string';
      else if (tok === 'true' || tok === 'false') cls = 'pg-json-bool';
      else if (tok === 'null') cls = 'pg-json-null';
      else if (/^-?\d/.test(tok)) cls = 'pg-json-number';
      if (cls) {
        const s = el('span', cls, tok);
        parent.appendChild(s);
      } else {
        parent.appendChild(document.createTextNode(tok));
      }
      lastIndex = match.index + tok.length;
    }
    if (lastIndex < json.length) {
      parent.appendChild(document.createTextNode(json.slice(lastIndex)));
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────────────────────────────────
  function init() {
    if (typeof cytoscape === 'undefined') {
      showToast('无法从 CDN 加载 Cytoscape.js，请检查网络连接。', 'error', '加载失败');
      return;
    }
    // Register the dagre layout extension if available.
    if (typeof cytoscape !== 'undefined' && typeof window.cytoscapeDagre !== 'undefined') {
      try { cytoscape.use(window.cytoscapeDagre); } catch (_) { /* may already be registered */ }
    }
    setTheme(getTheme());
    wireEvents();
    refreshStats();
    loadKinds().then(() => {
      renderEdgeChips();
    });
    loadDecorators().then(() => {
      const decoratorSection = $('#decorator-section');
      if (decoratorSection) {
        const hasDecorators = (state.decoratorTags && state.decoratorTags.length > 0);
        decoratorSection.hidden = state.mode === 'springcloud' && !hasDecorators;
      }
    });
    loadProfile().then(() => {
      if (state.profileId === 'generic') {
        state.mode = 'generic';
      }
      $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
      const isSC = state.mode === 'springcloud';
      const roleSection = $('#role-section');
      const layerSection = $('#layer-section');
      const moduleSection = $('#module-section');
      if (roleSection) roleSection.hidden = !isSC || !state.profile || !state.profile.roles || state.profile.roles.length === 0;
      if (layerSection) layerSection.hidden = !isSC || !state.profile || !state.profile.layers || state.profile.layers.length === 0;
      if (moduleSection) moduleSection.hidden = !isSC;
      renderDetailEmpty();
      loadOverview();
    });
    renderRoleChips();
    renderLayerChips();
    renderModuleChips();
    renderDetailEmpty();
    runSearch('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
