/* ============================================================================
 * CodeGraph — Local Web UI (front-end)
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
 *   -> switch active project. `path` may be a project root or its .codegraph dir.
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
    focusId: null,        // the root of the rendered graph
    selectedId: null,     // the node shown in the right panel
    selectedTab: 'code',
    layoutName: 'cose',
    activeKindFilter: null,
    activeDecoratorFilter: null,  // currently active decorator filter (null = all)
    lastQuery: '',
    kinds: { nodeKindColors: {}, edgeKindColors: {} },
    status: null,
    browsePath: null,
    browseParent: null,
  };

  const SEARCH_LIMIT = 50;     // dropdown cap
  const DEFAULT_DEPTH = 2;
  const EXPAND_DEPTH  = 3;

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
  async function runSearch(q) {
    state.lastQuery = q;
    const results = $('#results');
    const q2 = (q || '').trim();

    if (!q2) {
      clear(results);
      results.appendChild(el('div', 'results-empty', '输入关键词开始搜索…'));
      return;
    }
    try {
      const params = new URLSearchParams({ q: q2, limit: String(SEARCH_LIMIT) });
      if (state.activeKindFilter) params.set('kind', state.activeKindFilter);
      if (state.activeDecoratorFilter) params.set('decorator', state.activeDecoratorFilter);
      const data = await apiFetch('/api/search?' + params.toString());

      clear(results);
      if (!data.results || !data.results.length) {
        results.appendChild(el('div', 'results-empty', `没有匹配“${q2}”的结果。`));
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

        row.addEventListener('click', () => focusNode(r.node.id));
        frag.appendChild(row);
      });
      results.appendChild(frag);
    } catch (err) {
      clear(results);
      results.appendChild(el('div', 'results-empty', `搜索失败：${err.message}`));
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
      const data = await apiFetch('/api/overview?limit=80');
      renderGraph({
        nodes: data.nodes || [],
        edges: data.edges || [],
        rootId: null,
        depth: data.depth || 0,
        direction: data.direction || 'overview',
      }, { incremental: false });
      clearSelection();
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
      showToast('请输入项目根目录或 .codegraph 目录路径。', 'warn');
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
      showToast('已切换到新的 CodeGraph 索引。', 'ok', '加载完成');
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
      $('#btn-browse-select-current').disabled = !(data.isCodeGraphProject || data.isCodeGraphDir);
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
      const loadable = entry.isCodeGraphProject || entry.isCodeGraphDir;
      const meta = entry.isCodeGraphDir
        ? '.codegraph 索引目录'
        : entry.isCodeGraphProject
          ? 'CodeGraph 项目根目录'
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
    const cyNodes = apiNodes.map((n) => ({
      group: 'nodes',
      data: {
        id: n.id,
        label: n.name || n.id,
        kind: n.kind,
        color: n.color || '#94a3b8',
        filePath: n.filePath || '',
        qualifiedName: n.qualifiedName || '',
        startLine: n.startLine,
        endLine: n.endLine,
        signature: n.signature || '',
        language: n.language || '',
      },
    }));
    const cyEdges = apiEdges.map((e) => ({
      group: 'edges',
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.kind,
        kind: e.kind,
        color: e.color || '#475569',
      },
    }));
    return { cyNodes, cyEdges };
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
    meta.textContent = direction === 'overview'
      ? `项目概览 · ${nodes.length} 个节点 · ${edges.length} 条边`
      : `${nodes.length} 个节点 · ${edges.length} 条边 · 深度 ${depth} · ${translateDirection(direction)}`;

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
      selectNode(evt.target.id());
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
      const data = await apiFetch(
        `/api/context/${encodeURIComponent(id)}?depth=${depth}&direction=${direction}`
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

    activateTab(state.selectedTab);
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
      if (e.key === 'Escape') { e.target.value = ''; runSearch(''); e.target.blur(); }
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

    // Escape clears the tooltip if it's stuck.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $('#tooltip').hidden = true;
    });

    // Resize: cytoscape auto-fits, but a manual resize() helps in some browsers.
    let resizeT = null;
    window.addEventListener('resize', () => {
      if (resizeT) clearTimeout(resizeT);
      resizeT = setTimeout(() => { if (state.cy) state.cy.resize(); }, 120);
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Init
  // ──────────────────────────────────────────────────────────────────────────
  function init() {
    if (typeof cytoscape === 'undefined') {
      showToast('无法从 CDN 加载 Cytoscape.js，请检查网络连接。', 'error', '加载失败');
      return;
    }
    // Theme first — `data-theme` is already set on <html> so the first paint
    // matches localStorage. setTheme() also syncs the toggle button label.
    setTheme(getTheme());
    wireEvents();
    refreshStats();
    loadKinds();
    loadDecorators();
    runSearch('');
    loadOverview();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
