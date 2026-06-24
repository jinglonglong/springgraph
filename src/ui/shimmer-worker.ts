import { parentPort, workerData } from 'worker_threads';
import { getGlyphs } from './glyphs';
import type { ShimmerWorkerMessage, WorkerProgressMsg } from './types';

/**
 * Shimmer Worker — multi-stage progress renderer.
 *
 * Renders one block of N+1 lines per phase: a header line, then zero or more
 * per-worker sub-lines (for multi-threaded phases like parallel resolve).
 * Phases render in the order they were registered.
 *
 * RENDER STRATEGY (the flicker fix):
 *   The block is redrawn on a fixed interval (~80ms). Each render walks the
 *   full line list, but emits bytes ONLY for lines whose content changed
 *   since the last render. Cursor management: move up to top of block, walk
 *   down to the topmost dirty line, redraw from there to the end. Done-phase
 *   lines become frozen after their first render (icon is the static check
 *   glyph, no animation), so they never re-emit — eliminating the
 *   "everything redraws every frame" flicker. The cursor lands at col 0 of
 *   the line immediately after the block, so the caller can keep printing
 *   (e.g. a final summary) without further shenanigans.
 *
 *   A running phase with N workers redraws 1+N lines every frame (the
 *   header's status icon cycles through the shimmer glyphs, and each
 *   worker's bar needs to advance). Done and idle phases are no-ops after
 *   the first render.
 *
 * Output uses `process.stdout.write` (not `fs.writeSync(1, ...)`) so
 * Node's TTY-aware encoding conversion runs — on Windows the active
 * console codepage (often CP936/CP949 for CJK) is honored, which keeps
 * Chinese / Japanese / Korean glyphs readable.
 */

type WorkerState = {
  id: number;
  current: number;
  total: number;
};

type PhaseState = {
  id: string;
  label: string;
  description: string;
  status: 'pending' | 'running' | 'done';
  current: number;
  total: number;
  detail: string;
  startTime: number;
  endTime: number | null;
  workers: WorkerState[];
};

const G = getGlyphs();
const ANIM_INTERVAL = 150;
const FRAMES_PER_GLYPH = 3;
const RENDER_INTERVAL_MS = 80;
const BAR_WIDTH = 20;

const RST = '\x1b[0m';
const DM = '\x1b[2m';
const GRN = '\x1b[32m';
const BOLD = '\x1b[1m';
const DIM_FG = '\x1b[90m';

const startTime: number = (workerData?.startTime as number | undefined) ?? Date.now();

const phases = new Map<string, PhaseState>();
const order: string[] = [];

/**
 * Last-rendered content for each line in the block. `null` = never rendered
 * (or rendered and then the block shrank past this index). Used by the
 * diff render to skip lines whose content hasn't changed.
 */
let lineContent: (string | null)[] = [];
let blockHeight = 0;

let renderInterval: NodeJS.Timeout | null = null;

function animFrame(): number {
  return Math.floor((Date.now() - startTime) / ANIM_INTERVAL);
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function shimmerColor(frame: number): string {
  const t = (Math.sin((frame * 2 * Math.PI) / 13) + 1) / 2;
  const r = lerp(160, 251, t);
  const g = lerp(100, 191, t);
  const b = lerp(9, 36, t);
  return `\x1b[38;2;${r};${g};${b}m${BOLD}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${(s - m * 60).toFixed(0)}s`;
}

function renderBar(frame: number, percent: number): string {
  if (percent <= 0) return `${DM}${G.barEmpty.repeat(BAR_WIDTH)}${RST}`;
  if (percent >= 100) return `${GRN}${G.barFilled.repeat(BAR_WIDTH)}${RST}`;
  const filled = Math.round((BAR_WIDTH * percent) / 100);
  const empty = BAR_WIDTH - filled;
  const cycleFrames = 24;
  const shimmerPos = ((frame % cycleFrames) / cycleFrames) * (filled + 6) - 3;
  const shimmerWidth = 3;
  let bar = '';
  for (let i = 0; i < filled; i++) {
    const dist = Math.abs(i - shimmerPos);
    const t = Math.max(0, 1 - dist / shimmerWidth);
    const r = lerp(160, 251, t);
    const g = lerp(100, 191, t);
    const b = lerp(9, 36, t);
    bar += `\x1b[38;2;${r};${g};${b}m${BOLD}${G.barFilled}`;
  }
  bar += `${RST}${DM}${G.barEmpty.repeat(empty)}${RST}`;
  return bar;
}

function formatProgress(percent: number, current: number, total: number): string {
  if (total > 0) {
    return `${renderBar(animFrame(), percent)}  ${formatNumber(current)}/${formatNumber(total)} (${percent}%)`;
  }
  if (current > 0) {
    return `${formatNumber(current)} 个`;
  }
  return '';
}

function renderHeaderLine(frame: number, phase: PhaseState): string {
  const glyph = G.spinner[Math.floor(frame / FRAMES_PER_GLYPH) % G.spinner.length] ?? G.spinner[0] ?? '·';
  const color = shimmerColor(frame);

  let statusIcon: string;
  let iconColor: string;
  if (phase.status === 'done') {
    statusIcon = G.phaseDone;
    iconColor = GRN;
  } else if (phase.status === 'running') {
    statusIcon = glyph;
    iconColor = color;
  } else {
    statusIcon = G.rail;
    iconColor = DM;
  }

  // Pad label to a fixed width so columns align. Chinese chars are 2 cells
  // wide in CJK-aware terminals, but we don't measure that here — over-padding
  // is fine, mis-alignment is the bigger sin. Use a generous pad.
  const padded = phase.label.length >= 14 ? phase.label : phase.label + '　'.repeat(14 - phase.label.length);

  let progress: string;
  if (phase.status === 'pending' && phase.total === 0) {
    progress = '';
  } else {
    const percent = phase.total > 0 ? Math.round((phase.current / phase.total) * 100) : 0;
    progress = `  ${formatProgress(percent, phase.current, phase.total)}`;
  }
  const desc = phase.description ? `  ${DM}${phase.description}${RST}` : '';
  const detail = phase.detail ? `  ${color}${phase.detail}${RST}` : '';

  let timing = '';
  if (phase.status === 'done' && phase.endTime !== null) {
    timing = `  ${DM}${G.dash} ${formatDuration(phase.endTime - phase.startTime)}${RST}`;
  } else if (phase.status === 'running') {
    timing = `  ${DM}${formatDuration(Date.now() - phase.startTime)}${RST}`;
  }

  return `${iconColor}${statusIcon}${RST} ${padded}${progress}${desc}${detail}${timing}`;
}

function renderWorkerLine(_frame: number, phase: PhaseState, worker: WorkerState): string {
  // Worker bars use the same shimmer as the header bar so the visual
  // language is consistent. Status comes from the bar fill (>=100% is
  // implicitly "done"); the parent phase controls whether workers animate
  // (running parent -> animate; done parent -> frozen).
  const percent = worker.total > 0 ? Math.min(100, Math.round((worker.current / worker.total) * 100)) : 0;
  const bar = phase.status === 'running' ? renderBar(animFrame(), percent) : renderBar(0, percent);
  const cur = formatNumber(worker.current);
  const tot = formatNumber(worker.total);
  // Two-space indent + tree-rail glyph + "worker-N" + bar + numbers. The
  // tree glyph (├── / └──) implies the worker is a child of the phase.
  const tree = G.treeBranch;
  const label = `worker-${worker.id}`;
  return `${DIM_FG}${tree}${RST} ${label.padEnd(10, ' ')}  ${bar}  ${cur}/${tot} (${percent}%)`;
}

/**
 * Build the current set of renderable lines from the phases map. Rebuilds
 * the lineLayout array so the diff algorithm below can map absolute line
 * indices back to (phase, workerIdx) pairs.
 */
function buildLines(frame: number): string[] {
  const out: string[] = [];
  for (const id of order) {
    const phase = phases.get(id);
    if (!phase) continue;
    out.push(renderHeaderLine(frame, phase));
    for (let w = 0; w < phase.workers.length; w++) {
      const worker = phase.workers[w]!;
      out.push(renderWorkerLine(frame, phase, worker));
    }
  }
  return out;
}

/**
 * Incremental render. Walks the line list and emits only the lines that
 * changed since the last render. Cursor navigation: move to top of block,
 * skip down to the topmost dirty line, redraw from there to the end. When
 * the block grows (a new phase is added or a phase gains its first
 * worker) the previously-existing lines are still considered "unchanged"
 * and not re-emitted; only the new tail is drawn.
 */
function render(): void {
  if (order.length === 0) return;
  const frame = animFrame();
  const newLines = buildLines(frame);

  // Trim stored content if the block shrunk (phase removed — not currently
  // supported, but cheap insurance).
  if (lineContent.length > newLines.length) {
    lineContent.length = newLines.length;
  }

  // Find the topmost dirty line — i.e. the first index where the content
  // differs from the previously rendered content. If everything is clean
  // (e.g. a running phase with frozen worker lines), skip the whole render.
  let topDirty = -1;
  for (let i = 0; i < newLines.length; i++) {
    if (lineContent[i] !== newLines[i]) {
      topDirty = i;
      break;
    }
  }
  if (topDirty === -1) return;

  // Move cursor to top of block. `blockHeight` is the line count from the
  // last successful render; the cursor is "below the block" between renders.
  if (blockHeight > 0) {
    process.stdout.write(`\x1b[${blockHeight}A`);
  }
  // Walk down to the topmost dirty line (no-op when topDirty === 0).
  if (topDirty > 0) {
    process.stdout.write(`\x1b[${topDirty}B`);
  }

  // Redraw from topDirty to the end. After this loop, the cursor is at
  // col 0 of the line immediately after the last rendered line — exactly
  // the "below the block" position we need.
  for (let i = topDirty; i < newLines.length; i++) {
    const line = newLines[i] as string;
    process.stdout.write('\r\x1b[K');
    process.stdout.write(line);
    lineContent[i] = line;
    if (i < newLines.length - 1) {
      process.stdout.write('\n');
    }
  }

  blockHeight = newLines.length;
}

function ensureRenderLoop(): void {
  if (renderInterval === null) {
    renderInterval = setInterval(render, RENDER_INTERVAL_MS);
  }
}

function findPhase(id: string): PhaseState | undefined {
  return phases.get(id);
}

function ensurePhase(id: string, label: string, description: string): PhaseState {
  let phase = phases.get(id);
  if (!phase) {
    phase = {
      id,
      label,
      description,
      status: 'pending',
      current: 0,
      total: 0,
      detail: '',
      startTime: Date.now(),
      endTime: null,
      workers: [],
    };
    phases.set(id, phase);
    order.push(id);
  }
  return phase;
}

parentPort?.on('message', (msg: ShimmerWorkerMessage) => {
  switch (msg.type) {
    case 'add-phase': {
      ensurePhase(msg.id, msg.label, msg.description ?? '');
      ensureRenderLoop();
      break;
    }
    case 'start-phase': {
      const phase = findPhase(msg.id);
      if (phase && phase.status === 'pending') {
        phase.status = 'running';
        phase.startTime = Date.now();
      }
      break;
    }
    case 'update-phase': {
      const phase = findPhase(msg.id);
      if (phase) {
        if (phase.status === 'pending') {
          phase.status = 'running';
          phase.startTime = Date.now();
        }
        phase.current = msg.current;
        phase.total = msg.total;
        if (msg.detail !== undefined) phase.detail = msg.detail;
      }
      break;
    }
    case 'complete-phase': {
      const phase = findPhase(msg.id);
      if (phase) {
        phase.status = 'done';
        phase.endTime = Date.now();
        if (phase.total === 0 && phase.current > 0) phase.total = phase.current;
      }
      break;
    }
    case 'update-workers': {
      const phase = findPhase(msg.phaseId);
      if (phase) {
        phase.workers = msg.workers.map((w: WorkerProgressMsg) => ({
          id: w.id,
          current: w.current,
          total: w.total,
        }));
      }
      break;
    }
    case 'legacy-update': {
      // Auto-register a phase from the old onProgress({ phase, current, total })
      // API. Mirrors the old single-bar behavior: each new phase id implicitly
      // marks the previous as done.
      const existing = phases.get(msg.phase);
      if (!existing) {
        for (const id of order) {
          const other = phases.get(id)!;
          if (other.status === 'running') {
            other.status = 'done';
            other.endTime = Date.now();
          }
        }
        const phase = ensurePhase(msg.phase, msg.label, String(msg.description ?? ''));
        phase.status = 'running';
        phase.current = msg.current;
        phase.total = msg.total;
        phase.startTime = Date.now();
      } else {
        existing.status = 'running';
        existing.current = msg.current;
        existing.total = msg.total;
      }
      ensureRenderLoop();
      break;
    }
    case 'stop': {
      if (renderInterval !== null) {
        clearInterval(renderInterval);
        renderInterval = null;
      }
      for (const id of order) {
        const phase = phases.get(id)!;
        if (phase.status === 'running') {
          phase.status = 'done';
          phase.endTime = Date.now();
        }
      }
      render();
      // Drop below our last line so the caller can keep printing.
      if (blockHeight > 0) {
        process.stdout.write('\n');
        blockHeight = 0;
      }
      lineContent = [];
      parentPort?.postMessage({ type: 'stopped' });
      break;
    }
  }
});
