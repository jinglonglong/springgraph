import { getGlyphs } from './glyphs';
// Install the SQLite warning filter in the shimmer child even though it does
// not use SQLite — it inherits stderr and should not let stray warnings leak.
import '../errors';
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
 * Output uses `process.stdout.write` so Node's TTY-aware encoding conversion
 * runs — on Windows the active console codepage (often CP936/CP949 for CJK)
 * is honored, which keeps Chinese / Japanese / Korean glyphs readable.
 * The renderer is spawned as a child_process (not a worker_thread) so this
 * stdout is its own file descriptor and does not proxy through the busy main
 * thread; animation stays smooth even when the main thread is blocked in
 * SQLite writes or synthesizers.
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
const RENDER_INTERVAL_MS = 200;
const BAR_WIDTH = 20;

const RST = '\x1b[0m';
const DM = '\x1b[2m';
const GRN = '\x1b[32m';
const BOLD = '\x1b[1m';
// Use ANSI cursor movement only when the parent process tells us it's safe.
// The parent decides based on its own stdout.isTTY plus NO_COLOR/CI env vars;
// child_process inherited file descriptors are not a reliable signal on
// Windows, so we don't check isTTY here.
const useAnsi = process.env.SPRINGGRAPH_SHIMMER_USE_ANSI === '1';

let startTime: number = Date.now();
if (typeof process.env.SPRINGGRAPH_SHIMMER_START_TIME === 'string' && process.env.SPRINGGRAPH_SHIMMER_START_TIME !== '') {
  const parsed = Number.parseInt(process.env.SPRINGGRAPH_SHIMMER_START_TIME, 10);
  if (Number.isFinite(parsed)) {
    startTime = parsed;
  }
}

const phases = new Map<string, PhaseState>();
const order: string[] = [];

// Height of the rendered block, in logical lines (not terminal rows). Used
// to move the cursor from "below the block" back to the top on each redraw.
let maxBlockHeight = 0;

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

function renderBar(_frame: number, percent: number): string {
  if (percent <= 0) return `${DM}${G.barEmpty.repeat(BAR_WIDTH)}${RST}`;
  if (percent >= 100) return `${GRN}${G.barFilled.repeat(BAR_WIDTH)}${RST}`;
  const filled = Math.round((BAR_WIDTH * percent) / 100);
  const empty = BAR_WIDTH - filled;
  // Static fill: no shimmer sweep so the bar reads as solid progress rather
  // than a scanning/polling animation.
  return `${BOLD}\x1b[38;2;200;150;60m${G.barFilled.repeat(filled)}${RST}${DM}${G.barEmpty.repeat(empty)}${RST}`;
}

function formatProgress(percent: number, current: number, total: number): string {
  if (total > 0) {
    return `${renderBar(0, percent)}  ${formatNumber(current)}/${formatNumber(total)} (${percent}%)`;
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
  } else   if (phase.status === 'running') {
    statusIcon = glyph;
    iconColor = GRN;
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

function renderPlainBar(percent: number): string {
  if (percent <= 0) return '-'.repeat(BAR_WIDTH);
  if (percent >= 100) return '#'.repeat(BAR_WIDTH);
  const filled = Math.round((BAR_WIDTH * percent) / 100);
  const empty = BAR_WIDTH - filled;
  return '#'.repeat(filled) + '-'.repeat(empty);
}

function renderPlainHeaderLine(phase: PhaseState): string {
  const statusIcon = phase.status === 'done' ? '*' : phase.status === 'running' ? '>' : '|';
  const padded = phase.label.length >= 14 ? phase.label : phase.label + '　'.repeat(14 - phase.label.length);

  let progress = '';
  if (!(phase.status === 'pending' && phase.total === 0)) {
    const percent = phase.total > 0 ? Math.round((phase.current / phase.total) * 100) : 0;
    if (phase.total > 0) {
      progress = `  ${renderPlainBar(percent)}  ${formatNumber(phase.current)}/${formatNumber(phase.total)} (${percent}%)`;
    } else if (phase.current > 0) {
      progress = `  ${formatNumber(phase.current)}`;
    }
  }
  const desc = phase.description ? `  ${phase.description}` : '';
  const detail = phase.detail ? `  ${phase.detail}` : '';

  let timing = '';
  if (phase.status === 'done' && phase.endTime !== null) {
    timing = `  - ${formatDuration(phase.endTime - phase.startTime)}`;
  }

  return `${statusIcon} ${padded}${progress}${desc}${detail}${timing}`;
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
  }
  return out;
}

// Plain-text progress mode for non-TTY output (pipes, CI, dumb terminals).
// Prints one line per completed phase and overwrites a single running-phase
// line with \r so logs stay readable without ANSI cursor gymnastics.
const plainCompletedPhases = new Set<string>();
let plainRunningLine = '';
let plainNeedFinalNewline = false;

function renderPlain(): void {
  if (order.length === 0) return;

  // Print any phases that just finished.
  for (const id of order) {
    const phase = phases.get(id);
    if (!phase) continue;
    if (phase.status === 'done' && !plainCompletedPhases.has(id)) {
      if (plainNeedFinalNewline) {
        process.stdout.write('\n');
        plainNeedFinalNewline = false;
      }
      process.stdout.write(renderPlainHeaderLine(phase));
      process.stdout.write('\n');
      plainCompletedPhases.add(id);
      plainRunningLine = '';
    }
  }

  // Find the most advanced running phase and overwrite the running line.
  let runningPhase: PhaseState | null = null;
  for (const id of order) {
    const phase = phases.get(id);
    if (phase?.status === 'running') {
      runningPhase = phase;
    }
  }
  if (runningPhase) {
    const line = renderPlainHeaderLine(runningPhase);
    if (line !== plainRunningLine) {
      process.stdout.write('\r');
      process.stdout.write(line);
      plainRunningLine = line;
      plainNeedFinalNewline = true;
    }
  }
}

/**
 * Full-block redraw.
 *
 * We deliberately do NOT use line-level diff: the block is tiny (≤10 lines),
 * and partial-redraw cursor math is fragile once lines wrap or the block
 * grows (worker sub-bars appearing under a phase). Instead, after every
 * render we emit a trailing newline so the cursor is at column 0 of the row
 * directly below the block. The next render moves up by `maxBlockHeight` rows,
 * clears everything below the cursor, redraws the whole block, and ends with
 * another newline. Done phases still redraw, but since their content is static
 * the visual result is stable.
 */

function render(): void {
  if (!useAnsi) {
    renderPlain();
    return;
  }
  if (order.length === 0) return;
  const frame = animFrame();
  const newLines = buildLines(frame);

  // Move cursor from "below the block" back to the top of the block. Use
  // the maximum block height ever seen so a growing block (e.g. worker
  // sub-bars appearing) still reaches the original top row. Clear each
  // redrawn line and then clear everything below the new block.
  if (maxBlockHeight > 0) {
    process.stdout.write(`\x1b[${maxBlockHeight}A`);
  }

  for (let i = 0; i < newLines.length; i++) {
    process.stdout.write('\r\x1b[K');
    process.stdout.write(newLines[i] as string);
    if (i < newLines.length - 1) {
      process.stdout.write('\n');
    }
  }
  process.stdout.write('\x1b[J');

  // Leave cursor on a fresh row below the block. This is the anchor point
  // the next render will move up from.
  process.stdout.write('\n');
  if (newLines.length > maxBlockHeight) {
    maxBlockHeight = newLines.length;
  }
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

function handleMessage(msg: ShimmerWorkerMessage): void {
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
        // Show a full bar when a phase completes, even if not all underlying
        // work was successfully resolved (e.g. many unresolved refs remain).
        // The real stats are reported elsewhere; the UI bar is about stage
        // completion.
        phase.current = phase.total;
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
      // marks the previous as done. When the phase already exists and is done,
      // ignore the update so a trailing onProgress() cannot reopen it.
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
      } else if (existing.status !== 'done') {
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
      // Render() already left the cursor on a fresh row below the block,
      // so we just reset the tracked height.
      maxBlockHeight = 0;
      if (process.send) {
        process.send({ type: 'stopped' });
      }
      break;
    }
  }
}

process.on('message', handleMessage);
