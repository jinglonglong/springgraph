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

## Hinweise

- `declProc` wird sowohl für `functionTypes` als auch `methodTypes` verwendet. CodeGraph unterscheidet anhand des AST-Kontexts (Parent ist `declClass` → method, sonst → function).
- Die `getVisibility`-Funktion traversiert aufwärts zum `declSection`-Knoten.
- Records werden als `class` behandelt, da `declClass` mit `kRecord` Kind-Knoten beides abdeckt.

