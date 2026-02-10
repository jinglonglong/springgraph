# Checklist: Pascal/Delphi Support in CodeGraph

## A) Plumbing (Infrastruktur)
- [ ] `npm install tree-sitter-pascal` als Dependency
- [ ] `src/types.ts`: `'pascal'` zum `Language` Union-Type hinzufügen
- [ ] `src/types.ts`: `DEFAULT_CONFIG.include` um `'**/*.pas'`, `'**/*.dpr'`, `'**/*.dpk'`, `'**/*.lpr'` erweitern
- [ ] `src/extraction/grammars.ts`: Grammar-Loader `pascal: () => require('tree-sitter-pascal')`
- [ ] `src/extraction/grammars.ts`: Extension-Mapping `.pas`, `.dpr`, `.dpk`, `.lpr` → `'pascal'`
- [ ] `src/extraction/grammars.ts`: Display-Name `pascal: 'Pascal / Delphi'`
- [ ] `src/extraction/tree-sitter.ts`: `LanguageExtractor` für `pascal` in `EXTRACTORS` Map

## B) Node-Extraktion
- [ ] `unit` / `program` / `library` → NodeKind `module`
- [ ] `declClass` → NodeKind `class` (inkl. record, object)
- [ ] `declIntf` → NodeKind `interface`
- [ ] `declProc` (top-level) → NodeKind `function`
- [ ] `declProc` (in Klasse) → NodeKind `method` (inkl. constructor/destructor)
- [ ] `declProp` → NodeKind `property`
- [ ] `declField` → NodeKind `field`
- [ ] `declEnum` → NodeKind `enum`
- [ ] `declEnumValue` → NodeKind `enum_member`
- [ ] `declConst` → NodeKind `constant`
- [ ] `declType` (einfach) → NodeKind `type_alias`

## C) Edge-Extraktion
- [ ] `declUses` → EdgeKind `imports`
- [ ] `declClass.parent[0]` → EdgeKind `extends`
- [ ] `declClass.parent[1..]` → EdgeKind `implements`
- [ ] `exprCall` → EdgeKind `calls`
- [ ] `exprDot` + `exprCall` → EdgeKind `calls` (qualifiziert)
- [ ] `TClass.Create` → EdgeKind `instantiates`
- [ ] Parent-Child Containment → EdgeKind `contains`

## D) Sichtbarkeit & Attribute
- [ ] `getVisibility`: `declSection` → public/private/protected
- [ ] `isStatic`: `kClass` in `declProc` → true
- [ ] `getSignature`: Parameter + Rückgabetyp extrahieren

## E) Resolution
- [ ] `moduleName` → `unitName → fileId` Mapping
- [ ] `uses X;` → Unit-Node auflösen
- [ ] `uses X in 'path'` → Datei direkt auflösen (Phase 2)
- [ ] Call-Resolution: gleiche Unit → gleiche Klasse → uses-Units → global

## F) Testing
- [ ] Fixtures in Test-Suite aufnehmen (`UAuth.pas`, `App.dpr`, `UTypes.pas`)
- [ ] Nodes: Anzahl + Namen verifizieren
- [ ] Edges: imports/extends/implements/calls prüfen
- [ ] Sichtbarkeiten prüfen
- [ ] Properties, Enums, Konstanten prüfen

## G) Polishing
- [ ] Language in Supported-Languages-Dokumentation aufnehmen
- [ ] CLI-Hilfe / Config-Validierung aktualisieren

## H) Bekannte Einschränkungen (für spätere Phasen)
- [ ] **`with`-Statements** (Phase 2): Verschleiern den Qualifier bei Aufrufen. Im MVP werden Calls innerhalb von `with`-Blöcken ohne Qualifier extrahiert.
- [ ] **`.dfm`/`.fmx` Form-Dateien** (Zukunft): Enthalten Komponenten-Deklarationen und Event-Verknüpfungen. Aktuell nicht unterstützt.
- [ ] **`.inc` Include-Dateien** (Optional): Enthalten Code-Fragmente, die per `{$I filename}` eingebunden werden. Parser liefert möglicherweise keinen vollständigen AST.
- [ ] **Class Helpers / Record Helpers** (Phase 2): `declHelper`-Knoten erweitern existierende Typen. Erfordert spezielle Resolution-Logik.
- [ ] **Generics** (Phase 2): `typerefTpl` und `genericTpl` für generische Typen.
