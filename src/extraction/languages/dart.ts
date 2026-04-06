import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

export const dartExtractor: LanguageExtractor = {
  functionTypes: ['function_signature'],
  classTypes: ['class_definition'],
  methodTypes: ['method_signature'],
  interfaceTypes: [],
  structTypes: [],
  enumTypes: ['enum_declaration'],
  enumMemberTypes: ['enum_constant'],
  typeAliasTypes: ['type_alias'],
  importTypes: ['import_or_export'],
  callTypes: [],  // Dart calls use identifier+selector, handled via function body traversal
  variableTypes: [],
  extraClassNodeTypes: ['mixin_declaration', 'extension_declaration'],
  resolveBody: (node, bodyField) => {
    // Dart: function_body is a next sibling of function_signature/method_signature
    if (node.type === 'function_signature' || node.type === 'method_signature') {
      const next = node.nextNamedSibling;
      if (next?.type === 'function_body') return next;
      return null;
    }
    // For class/mixin/extension: try standard field, then class_body/extension_body
    const standard = node.childForFieldName(bodyField);
    if (standard) return standard;
    return node.namedChildren.find((c: SyntaxNode) =>
      c.type === 'class_body' || c.type === 'extension_body'
    ) || null;
  },
  nameField: 'name',
  bodyField: 'body', // class_definition uses 'body' field
  paramsField: 'formal_parameter_list',
  returnField: 'type',
  getSignature: (node, source) => {
    // For function_signature: extract params + return type
    // For method_signature: delegate to inner function_signature
    let sig = node;
    if (node.type === 'method_signature') {
      const inner = node.namedChildren.find((c: SyntaxNode) =>
        c.type === 'function_signature' || c.type === 'getter_signature' || c.type === 'setter_signature'
      );
      if (inner) sig = inner;
    }
    const params = sig.namedChildren.find((c: SyntaxNode) => c.type === 'formal_parameter_list');
    const retType = sig.namedChildren.find((c: SyntaxNode) =>
      c.type === 'type_identifier' || c.type === 'void_type'
    );
    if (!params && !retType) return undefined;
    let result = '';
    if (retType) result += getNodeText(retType, source) + ' ';
    if (params) result += getNodeText(params, source);
    return result.trim() || undefined;
  },
  getVisibility: (node) => {
    // Dart convention: _ prefix means private, otherwise public
    let nameNode: SyntaxNode | null = null;
    if (node.type === 'method_signature') {
      const inner = node.namedChildren.find((c: SyntaxNode) =>
        c.type === 'function_signature' || c.type === 'getter_signature' || c.type === 'setter_signature'
      );
      if (inner) nameNode = inner.namedChildren.find((c: SyntaxNode) => c.type === 'identifier') || null;
    } else {
      nameNode = node.childForFieldName('name');
    }
    if (nameNode && nameNode.text.startsWith('_')) return 'private';
    return 'public';
  },
  isAsync: (node) => {
    // In Dart, 'async' is on the function_body (next sibling), not the signature
    const nextSibling = node.nextNamedSibling;
    if (nextSibling?.type === 'function_body') {
      for (let i = 0; i < nextSibling.childCount; i++) {
        const child = nextSibling.child(i);
        if (child?.type === 'async') return true;
      }
    }
    return false;
  },
  isStatic: (node) => {
    // For method_signature, check for 'static' child
    if (node.type === 'method_signature') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'static') return true;
      }
    }
    return false;
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();
    let moduleName = '';

    // Dart imports: import 'dart:async'; import 'package:foo/bar.dart' as bar;
    const libraryImport = node.namedChildren.find((c: SyntaxNode) => c.type === 'library_import');
    if (libraryImport) {
      const importSpec = libraryImport.namedChildren.find((c: SyntaxNode) => c.type === 'import_specification');
      if (importSpec) {
        const configurableUri = importSpec.namedChildren.find((c: SyntaxNode) => c.type === 'configurable_uri');
        if (configurableUri) {
          const uri = configurableUri.namedChildren.find((c: SyntaxNode) => c.type === 'uri');
          if (uri) {
            const stringLiteral = uri.namedChildren.find((c: SyntaxNode) => c.type === 'string_literal');
            if (stringLiteral) {
              moduleName = getNodeText(stringLiteral, source).replace(/['"]/g, '');
            }
          }
        }
      }
    }

    // Also handle exports: export 'src/foo.dart';
    if (!moduleName) {
      const libraryExport = node.namedChildren.find((c: SyntaxNode) => c.type === 'library_export');
      if (libraryExport) {
        const configurableUri = libraryExport.namedChildren.find((c: SyntaxNode) => c.type === 'configurable_uri');
        if (configurableUri) {
          const uri = configurableUri.namedChildren.find((c: SyntaxNode) => c.type === 'uri');
          if (uri) {
            const stringLiteral = uri.namedChildren.find((c: SyntaxNode) => c.type === 'string_literal');
            if (stringLiteral) {
              moduleName = getNodeText(stringLiteral, source).replace(/['"]/g, '');
            }
          }
        }
      }
    }

    if (moduleName) {
      return { moduleName, signature: importText };
    }
    return null;
  },
};
