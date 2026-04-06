import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

export const rustExtractor: LanguageExtractor = {
  functionTypes: ['function_item'],
  classTypes: [], // Rust has impl blocks
  methodTypes: ['function_item'], // Methods are functions in impl blocks
  interfaceTypes: ['trait_item'],
  structTypes: ['struct_item'],
  enumTypes: ['enum_item'],
  enumMemberTypes: ['enum_variant'],
  typeAliasTypes: ['type_item'], // Rust type aliases
  importTypes: ['use_declaration'],
  callTypes: ['call_expression'],
  variableTypes: ['let_declaration', 'const_item', 'static_item'],
  interfaceKind: 'trait',
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  returnField: 'return_type',
  getSignature: (node, source) => {
    const params = getChildByField(node, 'parameters');
    const returnType = getChildByField(node, 'return_type');
    if (!params) return undefined;
    let sig = getNodeText(params, source);
    if (returnType) {
      sig += ' -> ' + getNodeText(returnType, source);
    }
    return sig;
  },
  isAsync: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'async') return true;
    }
    return false;
  },
  getVisibility: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'visibility_modifier') {
        return child.text.includes('pub') ? 'public' : 'private';
      }
    }
    return 'private'; // Rust defaults to private
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();

    // Helper to get the root crate/module from a scoped path
    const getRootModule = (scopedNode: SyntaxNode): string => {
      const firstChild = scopedNode.namedChild(0);
      if (!firstChild) return source.substring(scopedNode.startIndex, scopedNode.endIndex);
      if (firstChild.type === 'identifier' ||
          firstChild.type === 'crate' ||
          firstChild.type === 'super' ||
          firstChild.type === 'self') {
        return source.substring(firstChild.startIndex, firstChild.endIndex);
      } else if (firstChild.type === 'scoped_identifier') {
        return getRootModule(firstChild);
      }
      return source.substring(firstChild.startIndex, firstChild.endIndex);
    };

    // Find the use argument (scoped_use_list or scoped_identifier)
    const useArg = node.namedChildren.find((c: SyntaxNode) =>
      c.type === 'scoped_use_list' ||
      c.type === 'scoped_identifier' ||
      c.type === 'use_list' ||
      c.type === 'identifier'
    );

    if (useArg) {
      return { moduleName: getRootModule(useArg), signature: importText };
    }
    return null;
  },
};
