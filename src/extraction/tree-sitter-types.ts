/**
 * Tree-sitter Extraction Types
 *
 * Defines the LanguageExtractor interface and related types used by
 * the core TreeSitterExtractor and per-language extraction configs.
 * Extracted to a leaf module to avoid circular imports.
 */

import { Node as SyntaxNode } from 'web-tree-sitter';
import {
  Node,
  NodeKind,
  UnresolvedReference,
} from '../types';

/**
 * Information returned by a language's extractImport hook.
 */
export interface ImportInfo {
  /** The module/package name being imported */
  moduleName: string;
  /** Full import statement text for display */
  signature: string;
  /** If true, the hook already created unresolved references itself */
  handledRefs?: boolean;
}

/**
 * Information about a single variable within a declaration.
 * Returned by a language's extractVariables hook.
 */
export interface VariableInfo {
  /** Variable name */
  name: string;
  /** Node kind: 'variable' or 'constant' */
  kind: NodeKind;
  /** Optional signature string */
  signature?: string;
  /** If set, this declarator is actually a function and should be extracted as such */
  delegateToFunction?: SyntaxNode;
  /** The AST node to use for positioning (may differ from the declaration node) */
  positionNode?: SyntaxNode;
}

/**
 * Context object passed to language hooks that need to call back into the core extractor.
 * Provides a controlled API surface — hooks can create nodes, visit children, and add
 * references without accessing the full TreeSitterExtractor internals.
 */
export interface ExtractorContext {
  /** Create a node and add it to the extraction result */
  createNode(kind: NodeKind, name: string, node: SyntaxNode, extra?: Partial<Node>): Node | null;
  /** Visit a child node (dispatches through the standard visitNode logic) */
  visitNode(node: SyntaxNode): void;
  /** Visit a function body to extract calls */
  visitFunctionBody(body: SyntaxNode, functionId: string): void;
  /** Add an unresolved reference */
  addUnresolvedReference(ref: UnresolvedReference): void;
  /** Current file path */
  readonly filePath: string;
  /** Current source text */
  readonly source: string;
  /** Stack of parent node IDs (current scope) */
  readonly nodeStack: readonly string[];
  /** All nodes extracted so far */
  readonly nodes: readonly Node[];
}

/**
 * Language-specific extraction configuration.
 *
 * Each supported language provides an implementation of this interface
 * that configures which AST node types to look for and how to extract
 * language-specific details like signatures, visibility, and imports.
 */
export interface LanguageExtractor {
  // --- Node type mappings ---

  /** Node types that represent functions */
  functionTypes: string[];
  /** Node types that represent classes */
  classTypes: string[];
  /** Node types that represent methods */
  methodTypes: string[];
  /** Node types that represent interfaces/protocols/traits */
  interfaceTypes: string[];
  /** Node types that represent structs */
  structTypes: string[];
  /** Node types that represent enums */
  enumTypes: string[];
  /** Node types that represent enum members/cases (e.g. Swift: 'enum_entry', Rust: 'enum_variant') */
  enumMemberTypes?: string[];
  /** Node types that represent type aliases (e.g. `type X = ...`) */
  typeAliasTypes: string[];
  /** Node types that represent imports */
  importTypes: string[];
  /** Node types that represent function calls */
  callTypes: string[];
  /** Node types that represent variable declarations (const, let, var, etc.) */
  variableTypes: string[];

  // --- Field name mappings ---

  /** Field name for identifier/name */
  nameField: string;
  /** Field name for body */
  bodyField: string;
  /** Field name for parameters */
  paramsField: string;
  /** Field name for return type */
  returnField?: string;

  // --- Existing hooks ---

  /** Extract signature from node */
  getSignature?: (node: SyntaxNode, source: string) => string | undefined;
  /** Extract visibility from node */
  getVisibility?: (node: SyntaxNode) => 'public' | 'private' | 'protected' | 'internal' | undefined;
  /** Check if node is exported */
  isExported?: (node: SyntaxNode, source: string) => boolean;
  /** Check if node is async */
  isAsync?: (node: SyntaxNode) => boolean;
  /** Check if node is static */
  isStatic?: (node: SyntaxNode) => boolean;
  /** Check if variable declaration is a constant (const vs let/var) */
  isConst?: (node: SyntaxNode) => boolean;

  // --- New config properties ---

  /** Additional node types to treat as class declarations (e.g. Dart: 'mixin_declaration') */
  extraClassNodeTypes?: string[];
  /** Whether methods can be top-level without enclosing class (Go: true) */
  methodsAreTopLevel?: boolean;
  /** NodeKind to use for interface-like declarations (Rust: 'trait'). Default: 'interface' */
  interfaceKind?: NodeKind;

  // --- New hooks ---

  /**
   * Custom node visitor. Return true if the node was fully handled (skip default dispatch).
   * Used by languages with fundamentally different AST structures (e.g. Pascal).
   */
  visitNode?: (node: SyntaxNode, ctx: ExtractorContext) => boolean;

  /**
   * Classify a class_declaration node when the grammar reuses one node type
   * for multiple concepts (e.g. Swift uses class_declaration for classes, structs, and enums).
   */
  classifyClassNode?: (node: SyntaxNode) => 'class' | 'struct' | 'enum';

  /**
   * Resolve the body node for a function/method/class when it's not a child field.
   * (e.g. Dart puts function_body as a sibling, not a child.)
   */
  resolveBody?: (node: SyntaxNode, bodyField: string) => SyntaxNode | null;

  /**
   * Extract import information from an import node.
   * Return null if the node isn't a recognized import form.
   */
  extractImport?: (node: SyntaxNode, source: string) => ImportInfo | null;

  /**
   * Extract variable declarations from a variable declaration node.
   * Returns info about each declared variable, allowing the core to create nodes.
   */
  extractVariables?: (node: SyntaxNode, source: string) => VariableInfo[];

  /**
   * Extract receiver/owner type name from a method declaration.
   * Used by Go to get the struct receiver (e.g., "scrapeLoop" from "func (sl *scrapeLoop) run()").
   * When present, the receiver type is included in the qualified name for better searchability.
   */
  getReceiverType?: (node: SyntaxNode, source: string) => string | undefined;
}
