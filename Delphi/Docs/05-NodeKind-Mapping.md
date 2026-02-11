# NodeKind Mapping: Delphi → CodeGraph

Dieses Dokument zeigt die explizite Zuordnung von Delphi/Pascal-Konzepten zu den bestehenden CodeGraph `NodeKind`- und `EdgeKind`-Werten.

> **Ergebnis:** Alle Delphi-Konzepte lassen sich auf existierende `NodeKind`-Werte abbilden. Es werden **keine neuen** Kinds benötigt.

## Node-Mapping

| Delphi-Konzept | tree-sitter Typ | CodeGraph `NodeKind` | Anmerkungen |
|---|---|---|---|
| Unit | `unit` + `moduleName` | `module` | Kompilierungseinheit, vergleichbar mit Modulen |
| Program | `program` + `moduleName` | `module` | Ausführbarer Einstiegspunkt |
| Library | `library` + `moduleName` | `module` | DLL/shared library |
| Klasse | `declClass` (mit `kClass`) | `class` | Standard-Klasse |
| Record | `declClass` (mit `kRecord`) | `class` | Value-Type, aber strukturell wie Klasse |
| Object | `declClass` (mit `kObject`) | `class` | Legacy, wie Klasse behandeln |
| Interface | `declIntf` (mit `kInterface`) | `interface` | — |
| DispInterface | `declIntf` (mit `kDispInterface`) | `interface` | COM-spezifisch |
| Procedure (top-level) | `declProc` (mit `kProcedure`) | `function` | Ohne Rückgabetyp |
| Function (top-level) | `declProc` (mit `kFunction`) | `function` | Mit Rückgabetyp |
| Methode | `declProc` in `declClass` | `method` | Instance-Methode |
| Constructor | `declProc` (mit `kConstructor`) | `method` | Spezielle Methode |
| Destructor | `declProc` (mit `kDestructor`) | `method` | Spezielle Methode |
| Class Method | `declProc` (mit `kClass`) | `method` | Statisch, `isStatic = true` |
| Property | `declProp` | `property` | Mit Getter/Setter |
| Feld | `declField` | `field` | — |
| Enum | `declEnum` | `enum` | — |
| Enum-Wert | `declEnumValue` | `enum_member` | — |
| Type-Alias | `declType` (einfach) | `type_alias` | `type TMyInt = Integer;` |
| Konstante | `declConst` | `constant` | — |
| Uses-Eintrag | `declUses` → `identifier` | `import` | Pro Unit-Name ein Import-Node |

## Edge-Mapping

| Delphi-Beziehung | Erkennung | CodeGraph `EdgeKind` |
|---|---|---|
| `uses X;` | `declUses` → Kind `identifier` | `imports` |
| Basisklasse | `declClass.parent[0]` (erster `typeref`) | `extends` |
| Interface-Impl. | `declClass.parent[1..]` (weitere `typeref`s) | `implements` |
| Funktionsaufruf | `exprCall` | `calls` |
| Qualifizierter Aufruf | `exprDot` → `exprCall` | `calls` |
| `TClass.Create` | `exprDot` mit `.Create` Suffix | `instantiates` |
| Unit enthält Klasse | AST Parent-Child | `contains` |
| Klasse enthält Methode | AST Parent-Child | `contains` |

## DFM/FMX Node-Mapping

DFM/FMX-Dateien werden durch einen eigenen `DfmExtractor` (Regex-basiert, analog `LiquidExtractor`) verarbeitet.

| DFM-Konzept | Erkennung | CodeGraph `NodeKind` | Anmerkungen |
|---|---|---|---|
| Formular | `object Form1: TForm1` (Top-Level) | `component` | Root-Komponente der DFM-Datei |
| UI-Komponente | `object Button1: TButton` (verschachtelt) | `component` | Jede Komponente wird ein Node |
| Geerbte Komponente | `inherited Form1: TForm1` | `component` | Formular-Vererbung |

## DFM/FMX Edge-Mapping

| DFM-Beziehung | Erkennung | CodeGraph `EdgeKind` | Beschreibung |
|---|---|---|---|
| Verschachtelung | `object` innerhalb `object` | `contains` | Panel1 enthält Button1 |
| Event-Handler | `OnClick = Button1Click` | `references` | Komponente → Methode in `.pas` |
| Datei enthält Formular | Top-Level `object` | `contains` | DFM-Datei → Root-Komponente |

> **Hinweis:** Event-Handler-Verknüpfungen werden als `UnresolvedReference` gespeichert und in der Resolution-Phase zur entsprechenden Methode in der zugehörigen `.pas`-Datei aufgelöst.

## Nicht abgebildete Konzepte (Phase 2+)

| Konzept | Grund |
|---|---|
| `with`-Statement | Kein eigener EdgeKind nötig; erschwert nur die Call-Qualifizierung |
| Class Helper | Kein eigener NodeKind; als `class` mit speziellem Bezug zum erweiterten Typ |
| `exports`-Klauseln | `declExports` → könnte als `export` NodeKind abgebildet werden |
| Generics | `typerefTpl` → beeinflusst Typ-Referenzen, nicht den NodeKind |

## Sichtbarkeit

| Delphi-Keyword | CodeGraph Visibility |
|---|---|
| `published` | `public` (CodeGraph kennt kein `published`) |
| `public` | `public` |
| `protected` | `protected` |
| `private` | `private` |
| `strict private` | `private` |
| `strict protected` | `protected` |
| (keine Angabe) | `public` (Default in Delphi-Klassen) |

