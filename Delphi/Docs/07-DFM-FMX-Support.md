# DFM/FMX Form-Dateien: Format-Referenz & Extraktions-Konzept

Delphi-Projekte bestehen nicht nur aus `.pas`-Dateien, sondern auch aus **Form-Dateien** (`.dfm` für VCL, `.fmx` für FireMonkey). Diese enthalten die visuelle Komponentenhierarchie und — besonders wertvoll für CodeGraph — die **Event-Handler-Verknüpfungen** zwischen UI-Komponenten und Pascal-Methoden.

## Warum DFM/FMX für CodeGraph relevant sind

| Information | Wert für CodeGraph |
|---|---|
| Komponenten-Deklarationen (`object Button1: TButton`) | NodeKind `component` — zeigt welche UI-Elemente existieren |
| Event-Handler (`OnClick = Button1Click`) | EdgeKind `references` — verknüpft UI mit Code in `.pas` |
| Komponenten-Hierarchie (verschachtelte `object`-Blöcke) | EdgeKind `contains` — zeigt Parent-Child-Beziehungen |
| Komponenten-Typ (`TButton`, `TPanel`, `TEdit`) | Metadata — Typ-Information für Impact-Analyse |

**Besonders wertvoll:** Wenn ein Entwickler eine Methode in der `.pas`-Datei umbenennt, zeigt CodeGraph sofort, dass ein DFM-Event-Handler darauf verweist → Impact-Analyse funktioniert über Dateigrenzen hinweg.

## DFM-Textformat

DFM-Dateien können in **Text** oder **Binär** gespeichert werden. Moderne Delphi-Projekte verwenden fast ausschließlich das Textformat (besser für Versionskontrolle). FMX-Dateien verwenden das gleiche Textformat.

### Grundstruktur

```
object Form1: TForm1
  Left = 0
  Top = 0
  Caption = 'Hauptformular'
  ClientHeight = 400
  ClientWidth = 600
  OnCreate = FormCreate
  OnDestroy = FormDestroy
  object Panel1: TPanel
    Left = 0
    Top = 0
    Width = 600
    Height = 50
    Align = alTop
    object Label1: TLabel
      Left = 16
      Top = 16
      Caption = 'Willkommen'
    end
    object Button1: TButton
      Left = 500
      Top = 12
      Caption = 'Login'
      OnClick = Button1Click
    end
  end
  object Memo1: TMemo
    Left = 0
    Top = 50
    Width = 600
    Height = 350
    Align = alClient
  end
end
```

### Syntax-Regeln

1. **Top-Level:** `object <Name>: <Typ>` — das Formular selbst
2. **Verschachtelte Komponenten:** `object <Name>: <Typ>` innerhalb eines anderen `object`-Blocks
3. **Properties:** `<Key> = <Value>` — einfache Zuweisung
4. **Event-Handler:** `On<Event> = <MethodenName>` — Verknüpfung zu Pascal-Methode
5. **Ende:** `end` schließt jeden `object`-Block
6. **Vererbung:** `inherited <Name>: <Typ>` statt `object` bei geerbten Formularen
7. **Inline-Objekte:** `inline <Name>: <Typ>` für inline erstellte Objekte

### Event-Handler erkennen

Event-Handler sind Properties, deren **Key mit `On` beginnt** und deren **Value ein Bezeichner** (kein String, keine Zahl) ist:

```
OnClick = Button1Click          ← Event-Handler → references Button1Click
OnChange = EditChanged          ← Event-Handler → references EditChanged
Caption = 'Nicht ein Event'     ← Normales Property (String-Wert)
Left = 100                      ← Normales Property (Zahl-Wert)
Align = alTop                   ← Normales Property (Enum-Wert)
```

### Mehrzeilige Properties

Einige Properties erstrecken sich über mehrere Zeilen:

```
  SQL.Strings = (
    'SELECT * FROM users'
    'WHERE active = 1'
    'ORDER BY name')
  Items.Strings = (
    'Option A'
    'Option B')
```

Diese sind für CodeGraph weniger relevant, müssen aber beim Parsen korrekt übersprungen werden.

## Extraktions-Strategie: DfmExtractor

Analog zum `LiquidExtractor` und `SvelteExtractor` wird ein **`DfmExtractor`** als Custom Extractor implementiert — **ohne tree-sitter**, rein Regex/Zeilen-basiert.

### Zu extrahierende Nodes

| DFM-Element | CodeGraph NodeKind | Beispiel |
|---|---|---|
| Top-Level `object` | `component` | `Form1: TForm1` |
| Verschachtelte `object` | `component` | `Button1: TButton` |
| `inherited` | `component` | Geerbte Komponente |

### Zu extrahierende Edges

| DFM-Beziehung | CodeGraph EdgeKind | Beschreibung |
|---|---|---|
| Verschachtelung | `contains` | Panel1 enthält Button1 |
| Event-Handler | `references` | Button1 → `Button1Click` (Methode in .pas) |
| Datei enthält Komponente | `contains` | DFM-Datei → Form1 |

### Parsing-Algorithmus (Pseudocode)

```
für jede Zeile:
  wenn "object <Name>: <Typ>" oder "inherited <Name>: <Typ>":
    → neuen component-Node erstellen
    → contains-Edge vom Parent
    → auf Stack pushen
  wenn "end":
    → Stack poppen
  wenn "<Key> = <Value>" und Key beginnt mit "On" und Value ist Bezeichner:
    → references-Edge: aktuelle Komponente → Value (Methodenname)
    → als UnresolvedReference speichern (wird später zur .pas-Methode aufgelöst)
  wenn mehrzeiliges Property (endet mit "("):
    → Zeilen überspringen bis ")"
```

### Verknüpfung DFM ↔ PAS

Die Zuordnung DFM → PAS erfolgt über den **Dateinamen**:
- `MainForm.dfm` gehört zu `MainForm.pas` (gleicher Basename)
- Event-Handler `Button1Click` → Methode `TForm1.Button1Click` in der zugehörigen `.pas`-Datei

Diese Verknüpfung erfolgt in der **Resolution-Phase**, nicht beim Parsen.

## Kein tree-sitter nötig

Es gibt keinen tree-sitter Parser für DFM/FMX. Das Format ist aber so einfach strukturiert (zeilenbasiert, keine komplexe Grammatik), dass ein Regex-basierter Parser vollkommen ausreicht — genau wie bei Liquid-Templates.

## Phase

DFM/FMX-Support wird als **Phase 1b** eingeplant — parallel zum Pascal-Support, da die Verknüpfung DFM ↔ PAS den größten Mehrwert liefert, wenn beides gleichzeitig verfügbar ist.

