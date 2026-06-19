/**
 * `springkg inspect` — query a symbol by type + identifier.
 *
 * Subcommands:
 *   endpoint <url>   — look up an HTTP endpoint by path
 *   feign <name>     — look up a Feign client by name
 *   mapper <ns>      — look up a MyBatis mapper by namespace
 *   config <key>     — look up a runtime config property (sensitive values never returned)
 *
 * Output mirrors the corresponding spring_* MCP tool so developers can
 * verify the same data the agent would see.
 */

import * as path from 'path';
import * as fs from 'fs';

// -----------------------------------------------------------------------------
// endpoint
// -----------------------------------------------------------------------------

export async function runInspectEndpoint(projectPath: string, url: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  const sk = await SpringKg.open({ projectPath });
  try {
    const db = sk.db.getDb();
    // Match by path (with or without HTTP method prefix).
    const rows = db.prepare(`
      SELECT id, method, path, handler_class_id, handler_method_id, source_file_path, source_line
      FROM spring_endpoints
      WHERE path = ? OR path LIKE ?
      ORDER BY method, path
      LIMIT 20
    `).all(url, `%${url}%`) as Array<{
      id: string; method: string; path: string;
      handler_class_id: string | null; handler_method_id: string | null;
      source_file_path: string; source_line: number;
    }>;

    if (rows.length === 0) {
      console.log(`No endpoint found matching: ${url}`);
      console.log('Tip: run `springkg index` first if the database is empty.');
      return;
    }

    for (const r of rows) {
      console.log(`## Endpoint ${r.method} ${r.path}`);
      console.log(`  ID: ${r.id}`);
      console.log(`  Source: ${r.source_file_path}:${r.source_line}`);
      if (r.handler_class_id) console.log(`  Handler class: ${r.handler_class_id}`);
      if (r.handler_method_id) console.log(`  Handler method: ${r.handler_method_id}`);
      console.log('');
    }
  } finally {
    await sk.close();
  }
}

// -----------------------------------------------------------------------------
// feign
// -----------------------------------------------------------------------------

export async function runInspectFeign(projectPath: string, name: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  const sk = await SpringKg.open({ projectPath });
  try {
    const db = sk.db.getDb();
    const rows = db.prepare(`
      SELECT id, client_name, target_service, target_url, method_count
      FROM spring_feign_clients
      WHERE client_name = ? OR client_name LIKE ? OR target_service = ? OR target_service LIKE ?
      ORDER BY client_name
      LIMIT 20
    `).all(name, `%${name}%`, name, `%${name}%`) as Array<{
      id: string; client_name: string; target_service: string;
      target_url: string | null; method_count: number;
    }>;

    if (rows.length === 0) {
      console.log(`No Feign client found matching: ${name}`);
      console.log('Tip: run `springkg index` first if the database is empty.');
      return;
    }

    for (const r of rows) {
      console.log(`## Feign Client ${r.client_name}`);
      console.log(`  ID: ${r.id}`);
      console.log(`  Target service: ${r.target_service}`);
      if (r.target_url) console.log(`  Target URL: ${r.target_url}`);
      console.log(`  Method count: ${r.method_count}`);
      console.log('');
    }
  } finally {
    await sk.close();
  }
}

// -----------------------------------------------------------------------------
// mapper
// -----------------------------------------------------------------------------

export async function runInspectMapper(projectPath: string, namespace: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  const sk = await SpringKg.open({ projectPath });
  try {
    const db = sk.db.getDb();
    // Find mapper symbols by qualified_name containing the namespace.
    const mappers = db.prepare(`
      SELECT id, name, qualified_name, file_path, start_line, end_line
      FROM spring_symbols
      WHERE kind = 'mapper' AND (qualified_name LIKE ? OR name LIKE ?)
      ORDER BY qualified_name
      LIMIT 20
    `).all(`%${namespace}%`, `%${namespace}%`) as Array<{
      id: string; name: string; qualified_name: string;
      file_path: string; start_line: number; end_line: number;
    }>;

    if (mappers.length === 0) {
      console.log(`No mapper found matching: ${namespace}`);
      console.log('Tip: run `springkg index` first if the database is empty.');
      return;
    }

    for (const m of mappers) {
      console.log(`## Mapper ${m.qualified_name}`);
      console.log(`  ID: ${m.id}`);
      console.log(`  Source: ${m.file_path}:${m.start_line}`);

      // Find SQL statements bound to this mapper
      const stmts = db.prepare(`
        SELECT id, sql_hash, sql_text, parameter_count, tables, source_file_path, source_line
        FROM spring_sql_statements
        WHERE mapper_id = ?
        ORDER BY source_line
        LIMIT 20
      `).all(m.id) as Array<{
        id: string; sql_hash: string; sql_text: string;
        parameter_count: number; tables: string | null;
        source_file_path: string; source_line: number;
      }>;

      if (stmts.length > 0) {
        console.log(`  SQL statements: ${stmts.length}`);
        for (const s of stmts) {
          const preview = s.sql_text.length > 120 ? s.sql_text.slice(0, 120) + '...' : s.sql_text;
          console.log(`    - [${s.source_file_path}:${s.source_line}] ${preview}`);
          if (s.tables) {
            try {
              const tables = JSON.parse(s.tables) as string[];
              if (tables.length > 0) console.log(`      Tables: ${tables.join(', ')}`);
            } catch { /* ignore */ }
          }
        }
      }
      console.log('');
    }
  } finally {
    await sk.close();
  }
}

// -----------------------------------------------------------------------------
// config (sensitive values NEVER returned)
// -----------------------------------------------------------------------------

export async function runInspectConfig(projectPath: string, key: string): Promise<void> {
  const { SpringKg } = await import('@colbymchenry/springkg-core');
  const sk = await SpringKg.open({ projectPath });
  try {
    const db = sk.db.getDb();
    const rows = db.prepare(`
      SELECT id, key, value_hash, is_sensitive, source_file_path, source_line, bean_id
      FROM runtime_config_properties
      WHERE key = ? OR key LIKE ?
      ORDER BY key
      LIMIT 20
    `).all(key, `%${key}%`) as Array<{
      id: string; key: string; value_hash: string;
      is_sensitive: number; source_file_path: string; source_line: number;
      bean_id: string | null;
    }>;

    if (rows.length === 0) {
      console.log(`No config property found matching: ${key}`);
      console.log('Tip: run `springkg index` first if the database is empty.');
      return;
    }

    for (const r of rows) {
      const sensitive = r.is_sensitive === 1;
      console.log(`## Config ${r.key}${sensitive ? ' [SENSITIVE]' : ''}`);
      console.log(`  ID: ${r.id}`);
      console.log(`  Source: ${r.source_file_path}:${r.source_line}`);
      if (r.bean_id) console.log(`  Bean: ${r.bean_id}`);
      // CRITICAL: never print the value. For sensitive entries, the value_hash
      // itself is also not printed (it could leak value content).
      if (sensitive) {
        console.log(`  Value: *** (sensitive — never returned)`);
        console.log(`  Value hash: ${r.value_hash ? '[present]' : '[missing]'}`);
      } else {
        console.log(`  Value hash: ${r.value_hash || '[missing]'}`);
      }
      console.log('');
    }

    // Remind the user that value contents are never written to the DB
    const anySensitive = rows.some((r) => r.is_sensitive === 1);
    if (anySensitive) {
      console.log('Note: sensitive config values are never stored in the database.');
      console.log('Only the value hash (sha256) is persisted for change detection.');
    }
    // touch unused imports to satisfy noUnusedLocals
    void path;
    void fs;
  } finally {
    await sk.close();
  }
}
