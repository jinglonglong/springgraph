/**
 * Search Query Utilities
 *
 * Shared module for search term extraction and scoring.
 */

import * as path from 'path';
import { Node } from '../types';

/**
 * Common stop words to filter from search queries
 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'are', 'was',
  'be', 'has', 'had', 'have', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'all', 'each',
  'every', 'how', 'what', 'where', 'when', 'who', 'which', 'why',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'find', 'show', 'get', 'list', 'give', 'tell',
]);

/**
 * Extract meaningful search terms from a natural language query
 */
export function extractSearchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOP_WORDS.has(term));
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

  return score;
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
    interface: 7,
    type_alias: 6,
    struct: 6,
    trait: 6,
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
    protocol: 6,
    enum_member: 3,
  };
  return bonuses[kind] ?? 0;
}
