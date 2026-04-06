/**
 * Search Query Utilities
 *
 * Shared module for search term extraction and scoring.
 */

import * as path from 'path';
import { Node } from '../types';

/**
 * Common stop words to filter from search queries.
 * Includes generic English + code-specific noise words.
 */
export const STOP_WORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'are', 'was',
  'be', 'has', 'had', 'have', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'all', 'each',
  'every', 'how', 'what', 'where', 'when', 'who', 'which', 'why',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'show', 'give', 'tell',
  'been', 'done', 'made', 'used', 'using', 'works', 'found',
  'also', 'into', 'then', 'than', 'just', 'more', 'some', 'such',
  'over', 'only', 'out', 'its', 'so', 'up', 'as', 'if',
  // Code-specific noise (avoid filtering common symbol names like get/set/add/build/find/list)
  'code', 'file', 'files', 'function', 'method', 'class', 'type',
  'fix', 'bug', 'called',
]);

/**
 * Extract meaningful search terms from a natural language query.
 * Splits camelCase, PascalCase, snake_case, SCREAMING_SNAKE, and dot.notation
 * into individual tokens before filtering.
 *
 * Preserves original compound identifiers (e.g., "scrapeLoop") alongside
 * their split parts so that FTS can match both the full symbol name and
 * individual words within it.
 */
export function extractSearchTerms(query: string): string[] {
  const tokens = new Set<string>();

  // First, extract and preserve compound identifiers before splitting
  // CamelCase: scrapeLoop, UserService, getCallGraph
  const compoundPattern = /\b([a-zA-Z][a-zA-Z0-9]*(?:[A-Z][a-z]+)+|[A-Z][a-z]+(?:[A-Z][a-z]*)+)\b/g;
  let match;
  while ((match = compoundPattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 3) {
      tokens.add(match[1].toLowerCase()); // preserve full compound: "scrapeloop"
    }
  }

  // snake_case: scrape_loop, user_service
  const snakePattern = /\b([a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)+)\b/g;
  while ((match = snakePattern.exec(query)) !== null) {
    if (match[1] && match[1].length >= 3) {
      tokens.add(match[1].toLowerCase());
    }
  }

  // Split camelCase / PascalCase: "getUserName" → "get User Name"
  const camelSplit = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Replace underscores and dots with spaces (snake_case, dot.notation)
  const normalised = camelSplit.replace(/[_.]+/g, ' ');

  // Split on any non-alphanumeric character
  const words = normalised.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 3) continue;
    if (STOP_WORDS.has(lower)) continue;
    tokens.add(lower);
  }

  return [...tokens];
}

/**
 * Score path relevance to a query
 * Higher score = more relevant path
 */
export function scorePathRelevance(filePath: string, query: string): number {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return 0;

  const pathLower = filePath.toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  const dirName = path.dirname(filePath).toLowerCase();
  let score = 0;

  for (const term of terms) {
    // Exact filename match (strongest)
    if (fileName.includes(term)) score += 10;
    // Directory match
    if (dirName.includes(term)) score += 5;
    // General path match
    else if (pathLower.includes(term)) score += 3;
  }

  // Deprioritize test files unless the query is explicitly about tests
  const queryLower = query.toLowerCase();
  const isTestQuery = queryLower.includes('test') || queryLower.includes('spec');
  if (!isTestQuery && isTestFile(filePath)) {
    score -= 15;
  }

  return score;
}

/**
 * Check if a file path looks like a test file
 */
export function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const fileName = path.basename(lower);

  // Common test file patterns
  return (
    fileName.startsWith('test_') ||
    fileName.startsWith('test.') ||
    fileName.endsWith('.test.ts') ||
    fileName.endsWith('.test.js') ||
    fileName.endsWith('.test.tsx') ||
    fileName.endsWith('.test.jsx') ||
    fileName.endsWith('.spec.ts') ||
    fileName.endsWith('.spec.js') ||
    fileName.endsWith('_test.go') ||
    fileName.endsWith('_test.py') ||
    fileName.endsWith('_test.rs') ||
    fileName.endsWith('Tests.java') ||
    fileName.endsWith('Test.java') ||
    lower.includes('/tests/') ||
    lower.includes('/test/') ||
    lower.includes('/__tests__/') ||
    lower.includes('/spec/')
  );
}

/**
 * Bonus when a node's name matches the search query.
 * Exact matches get the largest boost; prefix matches get smaller boosts.
 * Multi-word queries also check individual term matches against the name.
 */
export function nameMatchBonus(nodeName: string, query: string): number {
  const nameLower = nodeName.toLowerCase();

  // Split query into word-level terms (handles "CacheBuilder build" → ["cache","builder","build"])
  const rawTerms = query
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_.\-]+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 2);

  // Also keep original space-separated tokens for exact-term matching
  const queryTokens = query.split(/\s+/).map(t => t.toLowerCase()).filter(t => t.length >= 2);

  // Full query as a single token (for compound identifiers like "CacheBuilder")
  const queryLower = query.replace(/[\s]+/g, '').toLowerCase();

  // Exact match: query exactly equals the node name
  if (nameLower === queryLower) return 30;

  // Exact match on a query token: "CacheBuilder build" and node name is "build"
  if (queryTokens.length > 1 && queryTokens.includes(nameLower)) return 25;

  // Name starts with query (prefix search: "Cache" → "CacheBuilder")
  if (nameLower.startsWith(queryLower)) return 20;

  // All camelCase-split terms appear in the name
  if (rawTerms.length > 1) {
    const allMatch = rawTerms.every(t => nameLower.includes(t));
    if (allMatch) return 15;
  }

  // Name contains the full query as substring
  if (nameLower.includes(queryLower)) return 10;

  return 0;
}

/**
 * Kind-based bonus for search ranking
 * Functions and classes are typically more relevant than variables/imports
 */
export function kindBonus(kind: Node['kind']): number {
  const bonuses: Record<string, number> = {
    function: 10,
    method: 10,
    class: 8,
    interface: 9,
    type_alias: 6,
    struct: 6,
    trait: 9,
    enum: 5,
    component: 8,
    route: 9,
    module: 4,
    property: 3,
    field: 3,
    variable: 2,
    constant: 3,
    import: 1,
    export: 1,
    parameter: 0,
    namespace: 4,
    file: 0,
    protocol: 9,
    enum_member: 3,
  };
  return bonuses[kind] ?? 0;
}
