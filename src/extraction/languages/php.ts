import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

export const phpExtractor: LanguageExtractor = {
  functionTypes: ['function_definition'],
  classTypes: ['class_declaration'],
  methodTypes: ['method_declaration'],
  interfaceTypes: ['interface_declaration'],
  structTypes: [],
  enumTypes: ['enum_declaration'],
  enumMemberTypes: ['enum_case'],
  typeAliasTypes: [],
  importTypes: ['namespace_use_declaration'],
  callTypes: ['function_call_expression', 'member_call_expression', 'scoped_call_expression'],
  variableTypes: ['property_declaration', 'const_declaration'],
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  returnField: 'return_type',
  getVisibility: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'visibility_modifier') {
        const text = child.text;
        if (text === 'public') return 'public';
        if (text === 'private') return 'private';
        if (text === 'protected') return 'protected';
      }
    }
    return 'public'; // PHP defaults to public
  },
  isStatic: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'static_modifier') return true;
    }
    return false;
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();

    // Check for grouped imports: use X\{A, B} - return null for core fallback
    const namespacePrefix = node.namedChildren.find((c: SyntaxNode) => c.type === 'namespace_name');
    const useGroup = node.namedChildren.find((c: SyntaxNode) => c.type === 'namespace_use_group');
    if (namespacePrefix && useGroup) {
      return null; // Grouped imports create multiple nodes - let core handle
    }

    // Single import - find namespace_use_clause
    const useClause = node.namedChildren.find((c: SyntaxNode) => c.type === 'namespace_use_clause');
    if (useClause) {
      const qualifiedName = useClause.namedChildren.find((c: SyntaxNode) => c.type === 'qualified_name');
      if (qualifiedName) {
        return { moduleName: getNodeText(qualifiedName, source), signature: importText };
      }
      const name = useClause.namedChildren.find((c: SyntaxNode) => c.type === 'name');
      if (name) {
        return { moduleName: getNodeText(name, source), signature: importText };
      }
    }
    return null;
  },
};
