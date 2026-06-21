/**
 * Minimal type declarations for `node:sqlite` (available in Node 22.5+).
 * @types/node@20.x does not include these, so we declare only what we use.
 */

declare module 'node:sqlite' {
  class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
    readonly open: boolean;
  }

  interface StatementSync {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
  }

  export { DatabaseSync };
}
