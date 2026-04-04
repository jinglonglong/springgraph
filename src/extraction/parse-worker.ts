/**
 * Parse Worker
 *
 * Runs tree-sitter parsing in a separate thread so the main thread
 * stays unblocked and the UI animation renders smoothly.
 */

import { parentPort } from 'worker_threads';
import { extractFromSource } from './tree-sitter';
import { detectLanguage, loadGrammarsForLanguages, resetParser } from './grammars';
import type { Language, ExtractionResult } from '../types';

const PARSER_RESET_INTERVAL = 5000;
const parseCounts = new Map<Language, number>();

parentPort!.on('message', async (msg: { type: string; id?: number; filePath?: string; content?: string; languages?: Language[] }) => {
  if (msg.type === 'load-grammars') {
    await loadGrammarsForLanguages(msg.languages!);
    parentPort!.postMessage({ type: 'grammars-loaded' });
  } else if (msg.type === 'parse') {
    const { id, filePath, content } = msg;
    try {
      const language = detectLanguage(filePath!);
      const result: ExtractionResult = extractFromSource(filePath!, content!, language);

      // Periodic parser reset to reclaim WASM heap memory
      const count = (parseCounts.get(language) ?? 0) + 1;
      parseCounts.set(language, count);
      if (count % PARSER_RESET_INTERVAL === 0) {
        resetParser(language);
      }

      parentPort!.postMessage({ type: 'parse-result', id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({
        type: 'parse-result',
        id,
        result: {
          nodes: [],
          edges: [],
          unresolvedReferences: [],
          errors: [{ message: `Parse worker error: ${message}`, filePath: filePath!, severity: 'error', code: 'parse_error' }],
          durationMs: 0,
        } satisfies ExtractionResult,
      });
    }
  } else if (msg.type === 'shutdown') {
    parentPort!.postMessage({ type: 'shutdown-ack' });
  }
});
