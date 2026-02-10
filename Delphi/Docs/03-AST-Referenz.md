# AST-Referenz: tree-sitter-pascal (verifiziert)

Dieses Dokument zeigt die **tatsächlichen** AST-Knotentypen aus der [`tree-sitter-pascal`](https://github.com/Isopod/tree-sitter-pascal) Grammar, verifiziert anhand der `node-types.json` des Pakets.

> **Hinweis:** CodeGraph nutzt keine `.scm`-Dateien zur Extraktion, sondern ein `LanguageExtractor`-Objekt in TypeScript. Die hier dokumentierten AST-Strukturen zeigen, wie der Parser Delphi-Code als Baum darstellt.

## A) Top-Level Module

### unit
```
(unit (kUnit) (moduleName (identifier)) (interface ...) (implementation ...) (kEndDot))
```

### program
```
(program (kProgram) (moduleName (identifier)) ...body...)
```

### library
```
(library (kLibrary) (moduleName (identifier)) ...body...)
```

## B) Deklarationen

### declClass (Klassen, Records, Objects)
```
(declType
  name: (identifier)                  ← "TMyClass"
  value: (type (declClass
    (kClass)                           ← oder (kRecord), (kObject)
    parent: ((typeref) (typeref) ...)   ← Basisklasse + Interfaces
    (declSection (kPublic)             ← Sichtbarkeit
      (declProc ...)                   ← Methoden
      (declField ...)                  ← Felder
      (declProp ...)                   ← Properties
    )
    (kEnd))))
```

### declIntf (Interfaces)
```
(declType
  name: (identifier)                  ← "IMyInterface"
  value: (type (declIntf
    (kInterface)
    parent: ((typeref) ...)            ← Basis-Interface
    guid: (guid ...)                   ← optionale GUID
    (declProc ...) (declProp ...)
    (kEnd))))
```

### declProc (Procedures, Functions, Methods, Constructors, Destructors)
```
(declProc
  (kFunction)                          ← oder kProcedure, kConstructor, kDestructor
  name: (identifier)                   ← "MyMethod"
  args: (declArgs (declArg name: (identifier) type: (type ...)))
  type: (type ...)                     ← Rückgabetyp (nur bei functions)
  attribute: (procAttribute ...))      ← z.B. override, virtual, static
```

**Unterscheidung Funktion vs. Methode:**
- Top-Level: `declProc` als Kind von `interface`/`implementation`
- Methode: `declProc` als Kind von `declClass` oder `declIntf`
- Statisch: enthält `kClass` Kind-Knoten (`class procedure`)

### declProp (Properties)
```
(declProp (kProperty) name: (identifier) type: (type ...) (kRead) (identifier) (kWrite) (identifier))
```

### declField (Felder)
```
(declField name: (identifier) type: (type ...))
```

### declEnum (Enums)
```
(declEnum (declEnumValue name: (identifier)) (declEnumValue name: (identifier)) ...)
```

### declUses (uses-Klauseln)
```
(declUses (kUses) (identifier) (identifier) ...)
```
Optional mit Pfadangabe: `(kIn) (literalString)` für `uses Foo in 'path/Foo.pas'`

### declConst (Konstanten)
```
(declConst name: (identifier) type: (type ...) defaultValue: (defaultValue ...))
```

## C) Ausdrücke

### exprCall (Funktionsaufruf)
```
(exprCall (identifier) ...args...)                    ← WriteLn(...)
```

### exprDot (qualifizierter Zugriff)
```
(exprDot lhs: (identifier) operator: (kDot) rhs: (exprCall (identifier) ...))  ← Svc.Login(...)
(exprDot lhs: (identifier) operator: (kDot) rhs: (identifier))                 ← TAuthService.Create
```

## D) Sichtbarkeit (declSection)
```
(declSection (kPublic))    ← oder kPrivate, kProtected, kPublished, kStrict
```
Gilt für alle nachfolgenden Deklarationen bis zum nächsten `declSection` oder `kEnd`.

## E) Vererbung (parent-Feld von declClass)

Das `parent`-Feld enthält eine Liste von `typeref`-Knoten:
- **Erster** `typeref` = Basisklasse → EdgeKind `extends`
- **Weitere** `typeref`s = Interfaces → EdgeKind `implements`

```
(declClass (kClass) parent: ((typeref (identifier "TInterfacedObject")) (typeref (identifier "ITokenValidator"))) ...)
```

## F) Zusammenfassung: Relevante Knoten für CodeGraph

| AST-Knotentyp | Feld `name` | Weitere wichtige Felder |
|---|---|---|
| `unit`/`program`/`library` | Kind: `moduleName` | `interface`, `implementation` |
| `declClass` | via Parent `declType` | `parent` (Vererbung), `declSection` |
| `declIntf` | via Parent `declType` | `parent`, `guid` |
| `declProc` | `name` | `args`, `type`, `attribute` |
| `declProp` | `name` | `type` |
| `declField` | `name` | `type` |
| `declEnum` | — | Kind: `declEnumValue` |
| `declEnumValue` | `name` | `value` |
| `declConst` | `name` | `type`, `defaultValue` |
| `declUses` | — | Kind: `identifier` |
| `exprCall` | — | Kind: `identifier` (callee) |
| `exprDot` | — | `lhs`, `rhs` |

