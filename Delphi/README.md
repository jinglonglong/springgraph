# CodeGraph Pascal/Delphi Support — Konzept & Bauplan

Dieses Verzeichnis enthält einen **umsetzbaren Bauplan** für Pascal/Delphi-Support in CodeGraph. Es basiert auf der tatsächlichen CodeGraph-Architektur und den verifizierten AST-Knotentypen von [`tree-sitter-pascal`](https://github.com/Isopod/tree-sitter-pascal).

**Ziel:** CodeGraph soll **Pascal/Delphi**-Dateien indexieren und daraus **Nodes** (Units, Klassen, Methoden, Properties, Enums, …) sowie **Edges** (uses/imports, calls, extends, implements, …) extrahieren. Zusätzlich werden **DFM/FMX-Formulardateien** unterstützt, um UI-Komponenten und Event-Handler-Verknüpfungen zu erfassen.

## Inhalt

| Verzeichnis / Datei | Beschreibung |
|---|---|
| `Docs/01-Implementation-Plan.md` | Implementierungs-Roadmap mit konkreten AST-Typen |
| `Docs/02-Capture-Convention.md` | Wie Pascal an CodeGraphs `LanguageExtractor`-Interface andockt |
| `Docs/03-AST-Referenz.md` | Verifizierte AST-Knotentypen aus tree-sitter-pascal |
| `Docs/04-Checklist.md` | Umsetzungs-Checkliste mit bekannten Einschränkungen |
| `Docs/05-NodeKind-Mapping.md` | Explizite Zuordnung Delphi → CodeGraph NodeKind/EdgeKind |
| `Docs/06-Integration-Guide.md` | Konkrete Code-Diffs für `grammars.ts`, `types.ts`, `tree-sitter.ts` + DfmExtractor |
| `Docs/07-DFM-FMX-Support.md` | DFM/FMX Form-Dateien: Format-Referenz & Extraktions-Konzept |
| `fixtures/` | Delphi-Beispieldateien zum Testen (`.pas`, `.dpr`, `.dfm`) |
| `resolution/` | Resolver-Heuristiken (Unit-Mapping, Call-Resolution) |

## Architektur-Übersicht

CodeGraph verwendet **keine** per-Sprache Plugin-Verzeichnisse. Die Integration erfolgt zentral in drei Dateien:

1. **`src/types.ts`** — `Language` Union-Type und `DEFAULT_CONFIG.include` Patterns
2. **`src/extraction/grammars.ts`** — Grammar-Loader, Extension-Mapping, Display-Name
3. **`src/extraction/tree-sitter.ts`** — `LanguageExtractor`-Konfiguration in der `EXTRACTORS` Map

## Wie du damit arbeitest

1. **Integration Guide lesen** (`Docs/06-Integration-Guide.md`) — enthält die exakten Code-Änderungen
2. **`npm install tree-sitter-pascal`** als Dependency hinzufügen
3. **Änderungen in den drei Dateien** vornehmen (types.ts, grammars.ts, tree-sitter.ts)
4. **Resolver erweitern** (mindestens `uses` → Unit-File, einfache Call-Auflösung)
5. **Fixtures in die Tests aufnehmen** und Assertions hinzufügen

## Grammar & Parsing

**Pascal-Dateien** (`.pas`, `.dpr`, `.dpk`, `.lpr`) werden mit [`tree-sitter-pascal`](https://github.com/Isopod/tree-sitter-pascal) geparst (AST-basierte Extraktion via `LanguageExtractor`).

**DFM/FMX-Dateien** (`.dfm`, `.fmx`) werden mit einem **Custom Extractor** (`DfmExtractor`) verarbeitet — analog zu `LiquidExtractor` und `SvelteExtractor`. Das DFM-Textformat ist zeilenbasiert und wird per Regex geparst. Besonders wertvoll: Event-Handler wie `OnClick = Button1Click` erzeugen `references`-Edges zu den zugehörigen Methoden in der `.pas`-Datei.
