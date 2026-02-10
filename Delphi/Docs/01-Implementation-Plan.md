# Implementation Plan: Pascal/Delphi in CodeGraph

## 0) Prämissen

- CodeGraph extrahiert **Nodes** und **Edges** über **tree-sitter** und eine `LanguageExtractor`-Konfiguration pro Sprache in `src/extraction/tree-sitter.ts`.
- Sprachen werden zentral in drei Dateien registriert: `grammars.ts`, `types.ts`, und `tree-sitter.ts`.
- Danach folgt **Reference Resolution** (Calls → Definitionen, imports → Dateien, inheritance, framework patterns).
- **Grammar:** [`tree-sitter-pascal`](https://github.com/Isopod/tree-sitter-pascal) (unterstützt Delphi, FreePascal und Standard-Pascal).

## 1) Parser / Grammar

npm-Paket: `tree-sitter-pascal`

**Konkrete AST-Knoten (Auswahl):**

| tree-sitter-pascal Typ | Beschreibung |
|---|---|
| `unit`, `program`, `library` | Top-Level-Module |
| `moduleName` | Name des Moduls (Kind-Knoten von `unit`/`program`/`library`) |
| `declClass` | Klassen, Records, Objects (enthält `kClass`/`kRecord`/`kObject`) |
| `declIntf` | Interfaces (`kInterface`/`kDispInterface`) |
| `declProc` | Procedures, Functions, Methods, Constructors, Destructors |
| `declProp` | Properties |
| `declField` | Felder in Klassen/Records |
| `declEnum` | Aufzählungstypen |
| `declEnumValue` | Einzelne Enum-Werte |
| `declType` | Type-Deklarationen (enthält `declClass`/`declIntf`/`declEnum`/etc.) |
| `declUses` | `uses`-Klauseln (imports) |
| `declConst` | Konstanten-Deklarationen |
| `declSection` | Sichtbarkeitsbereiche (`kPrivate`/`kPublic`/`kProtected`/`kPublished`) |
| `declHelper` | Class/Record Helpers |
| `declExports` | exports-Klauseln |
| `defProc` | Implementations-Body einer Prozedur/Funktion |
| `exprCall` | Funktionsaufrufe |
| `exprDot` | Qualifizierte Zugriffe (`Obj.Method`) |
| `declArgs` | Parameterliste |
| `declArg` | Einzelner Parameter |

**Tasks:**
- `tree-sitter-pascal` als npm-Dependency hinzufügen
- Grammar-Loader in `src/extraction/grammars.ts` registrieren: `pascal: () => require('tree-sitter-pascal')`
- Extension-Mapping und Language-Typ anlegen (siehe Integration Guide)

## 2) File-Erkennung

Extensions (MVP):
- `.pas` (Units)
- `.dpr` (Delphi Program)
- `.dpk` (Delphi Package)
- `.lpr` (Lazarus Program)

Optional (Phase 2):
- `.inc` (Include-Fragmente) – erst später, da Parser möglicherweise keinen vollständigen AST liefert.

## 3) Extraktion (MVP)

### 3.1 Nodes

| Delphi-Konzept | tree-sitter Typ | → CodeGraph `NodeKind` |
|---|---|---|
| Unit / Program / Library | `unit` / `program` / `library` | `module` |
| Klasse / Record / Object | `declClass` | `class` |
| Interface | `declIntf` | `interface` |
| Procedure / Function (top-level) | `declProc` (mit `kProcedure`/`kFunction`) | `function` |
| Methode / Constructor / Destructor | `declProc` (mit `kConstructor`/`kDestructor`, oder innerhalb `declClass`) | `method` |
| Property | `declProp` | `property` |
| Feld | `declField` | `field` |
| Enum | `declEnum` | `enum` |
| Enum-Wert | `declEnumValue` | `enum_member` |
| Type-Alias | `declType` (einfache Alias-Formen) | `type_alias` |
| Konstante | `declConst` | `constant` |
| Uses-Klausel | `declUses` | `import` |

### 3.2 Edges

| Beziehung | Erkennung | → CodeGraph `EdgeKind` |
|---|---|---|
| `uses X, Y;` | `declUses` → Kind-Knoten `identifier` | `imports` |
| Klassen-Vererbung | `declClass` → `parent` Feld → erster `typeref` | `extends` |
| Interface-Implementierung | `declClass` → `parent` Feld → weitere `typeref`s | `implements` |
| Funktionsaufruf | `exprCall` | `calls` |
| Qualifizierter Aufruf | `exprDot` als Elternteil von `exprCall` | `calls` |
| Enthaltensein | Parent-Child im AST (z.B. `declClass` → `declProc`) | `contains` |
| Instanziierung | `exprCall` mit `TClassName.Create` | `instantiates` |

## 4) Reference Resolution (MVP)

### 4.1 Unit-Auflösung (`uses`)
- Index-Phase: Map `unitName → fileId` (aus `moduleName` Knoten in `unit`/`program`/`library`)
- Resolution: Bei `uses Foo, Bar;` Edges auf Ziel-Units setzen.
- Spezialfälle (Phase 2): `Foo in 'path\Foo.pas'` (DPR/DPK), Namespaces (`System.SysUtils`).

### 4.2 Call-Auflösung (best effort)
- Extraktion: Name aus `exprCall`, Qualifier aus `exprDot`
- Heuristik-Reihenfolge:
  1. lokale Procs/Funcs in der gleichen Unit
  2. Methoden in der gleichen Klasse
  3. Units aus `uses`
  4. globaler Fallback nach Name

## 5) Tests

- Fixtures aus `fixtures/` in die Test-Suite aufnehmen
- Assertions:
  - Node-Anzahl + zentrale Namen prüfen
  - `uses`-Edges (imports)
  - `extends`/`implements`-Edges
  - einfache Call-Edges
  - Sichtbarkeiten (public/private/protected)
  - Properties, Felder, Enums

## 6) Definition of Done

- `codegraph index` indexiert Delphi/Pascal-Dateien ohne Crash
- `codegraph_search` findet Klassen/Methoden/Properties
- `codegraph_callers/callees` liefert sinnvolle Ergebnisse für einfache Fälle
- `uses`-Graph stimmt (Unit-Abhängigkeiten)
- Sichtbarkeiten werden korrekt extrahiert
