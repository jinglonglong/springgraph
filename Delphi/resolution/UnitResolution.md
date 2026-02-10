# Unit Resolution Heuristics (uses → File)

## Input

- Extrahierte Edges vom Typ `imports` aus `declUses`-Knoten.
- Extrahierte Nodes vom Typ `module` aus `unit`/`program`/`library` (Name aus `moduleName`-Kind-Knoten).

## AST-Struktur

```
(declUses
  (kUses)
  (identifier "System.SysUtils")    ← Unit-Name
  (identifier "UAuth")              ← Unit-Name
  (kIn) (literalString "'UAuth.pas'")  ← optionaler Pfad
)
```

## MVP Algorithm

1. Build `unitName → nodeId` Map für alle indexierten Dateien (aus `moduleName`-Knoten).
2. Für jeden `imports`-Edge mit Zielname `X`:
   - Exakter Match auf `X`
   - Case-insensitiver Match (Delphi ist case-insensitive)
   - Namespace-Normalisierung:
     - `System.SysUtils` → versuche auch `SysUtils` (letzter Segment)
   - Dateiname-basierter Fallback: `X` → `X.pas` in den indexierten Dateien suchen
3. Falls aufgelöst: `edge.to_node_id = targetNodeId`
4. Falls nicht aufgelöst: `edge.to_symbol = X` beibehalten (Suche funktioniert trotzdem)

## DPR/DPK `in 'path'` (Phase 2)

In Delphi-Projektdateien kann ein expliziter Pfad angegeben werden:

```delphi
uses
  Foo in 'src/Foo.pas',
  Bar in 'Bar.pas';
```

Im AST erkennbar durch `(kIn) (literalString)` nach dem `(identifier)`.

**Enhancement:**
- `literalString` extrahieren und direkt zur Datei auflösen
- Pfad relativ zur DPR/DPK-Datei interpretieren
