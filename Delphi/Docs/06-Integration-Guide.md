# Integration Guide: Konkrete Code-Änderungen

Dieses Dokument zeigt die **exakten Änderungen** an den CodeGraph-Quelldateien, die für Pascal/Delphi-Support nötig sind.

## 1) Dependency installieren

```bash
npm install tree-sitter-pascal
```

## 2) `src/types.ts` — Language-Typ erweitern

```typescript
// Zum Language Union-Type hinzufügen (nach 'liquid'):
export type Language =
  | 'typescript'
  // ...bestehende Sprachen...
  | 'liquid'
  | 'pascal'       // ← NEU
  | 'unknown';
```

**DEFAULT_CONFIG.include** erweitern:

```typescript
include: [
  // ...bestehende Patterns...
  // Liquid (Shopify themes)
  '**/*.liquid',
  // Pascal / Delphi                    ← NEU
  '**/*.pas',
  '**/*.dpr',
  '**/*.dpk',
  '**/*.lpr',
],
```

## 3) `src/extraction/grammars.ts` — Grammar registrieren

### grammarLoaders Map:

```typescript
const grammarLoaders: Record<GrammarLanguage, GrammarLoader> = {
  // ...bestehende Loader...
  dart: () => {
    return require('@sengac/tree-sitter-dart');
  },
  pascal: () => {                       // ← NEU
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('tree-sitter-pascal');
  },
};
```

### EXTENSION_MAP:

```typescript
export const EXTENSION_MAP: Record<string, Language> = {
  // ...bestehende Mappings...
  '.liquid': 'liquid',
  '.svelte': 'svelte',
  '.pas': 'pascal',                     // ← NEU
  '.dpr': 'pascal',                     // ← NEU
  '.dpk': 'pascal',                     // ← NEU
  '.lpr': 'pascal',                     // ← NEU
};
```

### getLanguageDisplayName():

```typescript
const names: Record<Language, string> = {
  // ...bestehende Namen...
  liquid: 'Liquid',
  pascal: 'Pascal / Delphi',            // ← NEU
  unknown: 'Unknown',
};
```

## 4) `src/extraction/tree-sitter.ts` — LanguageExtractor

```typescript
pascal: {
  functionTypes: ['declProc'],          // Top-Level Funktionen/Prozeduren
  classTypes: ['declClass'],            // Klassen, Records, Objects
  methodTypes: ['declProc'],            // Methoden (in Klasse), Konstruktoren, Destruktoren
  interfaceTypes: ['declIntf'],         // Interfaces
  structTypes: [],                      // Records über declClass abgedeckt
  enumTypes: ['declEnum'],              // Aufzählungen
  typeAliasTypes: ['declType'],         // Type-Aliase
  importTypes: ['declUses'],            // uses-Klauseln
  callTypes: ['exprCall'],              // Funktionsaufrufe
  variableTypes: ['declField', 'declConst'], // Felder und Konstanten
  nameField: 'name',
  bodyField: 'body',                    // nur bei defProc (Implementierung)
  paramsField: 'args',                  // declArgs
  returnField: 'type',
  getSignature: (node, source) => {
    const args = getChildByField(node, 'args');
    const returnType = getChildByField(node, 'type');
    if (!args) return undefined;
    const argsText = getNodeText(args, source);
    return returnType
      ? getNodeText(returnType, source) + ' ' + argsText
      : argsText;
  },
  getVisibility: (node) => {
    // Suche den nächsten declSection-Vorfahren
    let current = node.parent;
    while (current) {
      if (current.type === 'declSection') {
        for (let i = 0; i < current.childCount; i++) {
          const child = current.child(i);
          if (child?.type === 'kPublic' || child?.type === 'kPublished')
            return 'public';
          if (child?.type === 'kPrivate') return 'private';
          if (child?.type === 'kProtected') return 'protected';
        }
      }
      current = current.parent;
    }
    return undefined;
  },
  isStatic: (node) => {
    // class procedure / class function
    for (let i = 0; i < node.childCount; i++) {
      if (node.child(i)?.type === 'kClass') return true;
    }
    return false;
  },
  isConst: (node) => {
    return node.type === 'declConst';
  },
},
```

## Hinweise zur Pascal-Integration

- `declProc` wird sowohl für `functionTypes` als auch `methodTypes` verwendet. CodeGraph unterscheidet anhand des AST-Kontexts (Parent ist `declClass` → method, sonst → function).
- Die `getVisibility`-Funktion traversiert aufwärts zum `declSection`-Knoten.
- Records werden als `class` behandelt, da `declClass` mit `kRecord` Kind-Knoten beides abdeckt.

---

## 5) DFM/FMX-Support: Custom Extractor

DFM/FMX-Dateien verwenden ein einfaches zeilenbasiertes Textformat (kein tree-sitter Parser vorhanden). Die Integration erfolgt analog zu `LiquidExtractor` und `SvelteExtractor` als **Custom Extractor**.

### Extension-Mapping ergänzen (`src/extraction/grammars.ts`)

```typescript
export const EXTENSION_MAP: Record<string, Language> = {
  // ...bestehende Mappings...
  '.pas': 'pascal',
  '.dpr': 'pascal',
  '.dpk': 'pascal',
  '.lpr': 'pascal',
  '.dfm': 'pascal',                      // ← NEU: DFM-Formulare
  '.fmx': 'pascal',                      // ← NEU: FMX-Formulare
};
```

> **Hinweis:** DFM/FMX werden als Sprache `pascal` registriert. Die Unterscheidung zwischen tree-sitter-Parsing (`.pas`) und Custom Extractor (`.dfm`/`.fmx`) erfolgt in `extractFromSource()` anhand der Dateiendung.

### DEFAULT_CONFIG.include ergänzen (`src/types.ts`)

```typescript
include: [
  // ...bestehende Patterns...
  '**/*.pas',
  '**/*.dpr',
  '**/*.dpk',
  '**/*.lpr',
  '**/*.dfm',                             // ← NEU
  '**/*.fmx',                             // ← NEU
],
```

### Routing in `extractFromSource()` (`src/extraction/tree-sitter.ts`)

```typescript
export function extractFromSource(
  filePath: string,
  source: string,
  language?: Language
): ExtractionResult {
  const detectedLanguage = language || detectLanguage(filePath);

  // Use custom extractor for Svelte
  if (detectedLanguage === 'svelte') {
    const extractor = new SvelteExtractor(filePath, source);
    return extractor.extract();
  }

  // Use custom extractor for Liquid
  if (detectedLanguage === 'liquid') {
    const extractor = new LiquidExtractor(filePath, source);
    return extractor.extract();
  }

  // Use custom extractor for DFM/FMX form files          ← NEU
  if (detectedLanguage === 'pascal' &&
      (filePath.endsWith('.dfm') || filePath.endsWith('.fmx'))) {
    const extractor = new DfmExtractor(filePath, source);
    return extractor.extract();
  }

  const extractor = new TreeSitterExtractor(filePath, source, detectedLanguage);
  return extractor.extract();
}
```

### DfmExtractor Klasse (Coding Style analog LiquidExtractor)

```typescript
/**
 * Custom extractor for Delphi DFM/FMX form files.
 *
 * DFM/FMX files describe the visual component hierarchy and event handler
 * bindings. They use a simple text format (object/end blocks) that we parse
 * with regex — no tree-sitter grammar exists for this format.
 *
 * Extracted information:
 * - Components as NodeKind `component`
 * - Nesting as EdgeKind `contains`
 * - Event handlers (OnClick = MethodName) as UnresolvedReference → EdgeKind `references`
 */
export class DfmExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  /**
   * Extract components and event handler references from DFM/FMX source
   */
  extract(): ExtractionResult {
    const startTime = Date.now();

    try {
      const fileNode = this.createFileNode();
      this.parseComponents(fileNode.id);
    } catch (error) {
      captureException(error, { operation: 'dfm-extraction', filePath: this.filePath });
      this.errors.push({
        message: `DFM extraction error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  /** Create a file node for the DFM form file */
  private createFileNode(): Node { /* ... analog LiquidExtractor ... */ }

  /** Parse object/end blocks and extract components + event handlers */
  private parseComponents(fileNodeId: string): void {
    const lines = this.source.split('\n');
    const stack: string[] = [fileNodeId]; // Stack der Parent-Node-IDs

    const objectPattern = /^\s*(object|inherited|inline)\s+(\w+)\s*:\s*(\w+)/;
    const eventPattern = /^\s*(On\w+)\s*=\s*(\w+)/;
    const endPattern = /^\s*end\s*$/;
    const multiLineStart = /=\s*\(\s*$/;
    let inMultiLine = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Mehrzeilige Properties überspringen
      if (inMultiLine) {
        if (line.trimEnd().endsWith(')')) inMultiLine = false;
        continue;
      }
      if (multiLineStart.test(line)) {
        inMultiLine = true;
        continue;
      }

      // Component-Deklaration
      const objMatch = line.match(objectPattern);
      if (objMatch) {
        const [, , name, typeName] = objMatch;
        const nodeId = generateNodeId(this.filePath, 'component', name, lineNum);
        this.nodes.push({
          id: nodeId,
          kind: 'component',
          name,
          qualifiedName: `${this.filePath}#${name}`,
          filePath: this.filePath,
          language: 'pascal',
          startLine: lineNum,
          endLine: lineNum, // wird beim zugehörigen 'end' aktualisiert
          startColumn: 0,
          endColumn: line.length,
          metadata: { componentType: typeName },
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: stack[stack.length - 1],
          target: nodeId,
          kind: 'contains',
        });
        stack.push(nodeId);
        continue;
      }

      // Event-Handler
      const eventMatch = line.match(eventPattern);
      if (eventMatch) {
        const [, , methodName] = eventMatch;
        this.unresolvedReferences.push({
          sourceNodeId: stack[stack.length - 1],
          targetName: methodName,
          kind: 'references',
          filePath: this.filePath,
          line: lineNum,
        });
        continue;
      }

      // Block-Ende
      if (endPattern.test(line)) {
        if (stack.length > 1) stack.pop();
      }
    }
  }
}
```

### Coding-Style-Hinweise

Der `DfmExtractor` folgt dem bestehenden Coding Style der Custom Extractors:

- **JSDoc-Kommentare** (`/** */`) für jede öffentliche Methode und die Klasse selbst
- **Private Felder** für `nodes`, `edges`, `unresolvedReferences`, `errors`
- **`generateNodeId()`** für deterministische Node-IDs
- **`captureException()`** für Error-Tracking in catch-Blöcken
- **`ExtractionResult`** als Return-Type von `extract()`
- **`UnresolvedReference`** für Event-Handler (werden in der Resolution-Phase aufgelöst)
- **Kein tree-sitter** — rein Regex/zeilenbasiertes Parsing

