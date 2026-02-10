# Capture Convention: Wie Pascal/Delphi an CodeGraph andockt

## Architektur-Übersicht

CodeGraph verwendet **keine** `.scm`-Query-Dateien für die Extraktion. Stattdessen wird die Logik über ein `LanguageExtractor`-Objekt in `src/extraction/tree-sitter.ts` definiert. Dieses Objekt mappt tree-sitter AST-Knotentypen auf die interne Verarbeitungslogik.

### Zentrale Dateien für die Integration

| Datei | Änderung |
|---|---|
| `src/extraction/grammars.ts` | Grammar-Loader, Extension-Mapping, Display-Name |
| `src/types.ts` | `Language`-Union-Type, `DEFAULT_CONFIG.include` Patterns |
| `src/extraction/tree-sitter.ts` | `EXTRACTORS`-Map mit `LanguageExtractor`-Konfiguration |

## LanguageExtractor-Interface

Die Konfiguration definiert, welche AST-Knotentypen welcher Semantik entsprechen:

```typescript
interface LanguageExtractor {
  functionTypes: string[];     // Top-Level Funktionen/Prozeduren
  classTypes: string[];        // Klassen, Records, Objects
  methodTypes: string[];       // Methoden, Konstruktoren, Destruktoren
  interfaceTypes: string[];    // Interfaces
  structTypes: string[];       // Structs (in Delphi: leer)
  enumTypes: string[];         // Enums
  typeAliasTypes: string[];    // Type-Aliase
  importTypes: string[];       // uses-Klauseln
  callTypes: string[];         // Funktionsaufrufe
  variableTypes: string[];     // Variable/Feld-Deklarationen
  nameField: string;           // AST-Feld für den Namen
  bodyField: string;           // AST-Feld für den Body
  paramsField: string;         // AST-Feld für Parameter
  returnField?: string;        // AST-Feld für Rückgabetyp
  getSignature?: (node, source) => string | undefined;
  getVisibility?: (node) => 'public' | 'private' | 'protected' | 'internal' | undefined;
  isExported?: (node, source) => boolean;
  isStatic?: (node) => boolean;
  isConst?: (node) => boolean;
}
```

## Konkrete Zuordnung für Pascal/Delphi

| LanguageExtractor-Feld | tree-sitter-pascal Typ(en) | Anmerkung |
|---|---|---|
| `functionTypes` | `['declProc']` | Top-Level, gefiltert nach Kontext (kein Parent `declClass`) |
| `classTypes` | `['declClass']` | Enthält class, record, object |
| `methodTypes` | `['declProc']` | Innerhalb `declClass`, inkl. constructor/destructor |
| `interfaceTypes` | `['declIntf']` | interface, dispinterface |
| `structTypes` | `[]` | Records werden über `declClass` (mit `kRecord`) abgedeckt |
| `enumTypes` | `['declEnum']` | Innerhalb von `declType` |
| `typeAliasTypes` | `['declType']` | Einfache `type X = Y` Deklarationen |
| `importTypes` | `['declUses']` | `uses`-Klauseln |
| `callTypes` | `['exprCall']` | Funktions-/Methodenaufrufe |
| `variableTypes` | `['declField', 'declConst']` | Felder und Konstanten |
| `nameField` | `'name'` | `declProc`, `declConst`, `declField`, `declEnumValue` haben `name`-Feld |
| `bodyField` | `'body'` | Nur bei `defProc` (Implementierungen) |
| `paramsField` | `'args'` | `declProc` hat `args`-Feld (`declArgs`) |
| `returnField` | `'type'` | `declProc` hat optionales `type`-Feld |

## Delphi-spezifische Herausforderungen

### declProc: Funktion oder Methode?

`declProc` wird sowohl für Top-Level-Funktionen als auch für Methoden verwendet. Die Unterscheidung erfolgt über den Kontext:
- **Top-Level**: Parent ist `interface` (der Unit-interface-Abschnitt) oder `implementation`
- **Methode**: Parent ist `declClass` oder `declIntf`
- **Kind-Unterscheidung**: Enthält `kProcedure`, `kFunction`, `kConstructor`, oder `kDestructor`

### Sichtbarkeit über declSection

Delphi gruppiert Mitglieder in Sichtbarkeitsbereichen:
```
declClass → declSection (kPublic) → declProc, declField, declProp
         → declSection (kPrivate) → declField
```
Die `getVisibility`-Funktion muss den nächsten `declSection`-Vorfahren inspizieren.

### Vererbung und Interface-Implementierung

`declClass` hat ein `parent`-Feld mit einer Liste von `typeref`-Knoten:
- Der **erste** `typeref` ist typischerweise die Basisklasse (`extends`)
- Weitere `typeref`s sind implementierte Interfaces (`implements`)

### `with`-Statements (Phase 2)

`with`-Statements erzeugen einen impliziten Scope, der Call-Qualifier verschleiert:
```delphi
with MyObj do
  DoSomething;  // ist eigentlich MyObj.DoSomething
```
Im MVP wird dies **nicht** aufgelöst – Calls innerhalb von `with` werden ohne Qualifier extrahiert.

### Namespaces

Delphi-Unit-Namen können Punkte enthalten (`System.SysUtils`). Der `moduleName`-Knoten enthält den vollständigen Namen. Die Resolution muss sowohl exakte Matches als auch Suffix-Matches unterstützen.
