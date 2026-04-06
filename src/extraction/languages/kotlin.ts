import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

export const kotlinExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration'],
  classTypes: ['class_declaration'],
  methodTypes: ['function_declaration'], // Methods are functions inside classes
  interfaceTypes: ['class_declaration'], // Interfaces use class_declaration with 'interface' modifier
  structTypes: [], // Kotlin uses data classes
  enumTypes: ['class_declaration'], // Enums use class_declaration with 'enum' modifier
  enumMemberTypes: ['enum_entry'],
  typeAliasTypes: ['type_alias'],
  importTypes: ['import_header'],
  callTypes: ['call_expression'],
  variableTypes: ['property_declaration'],
  nameField: 'simple_identifier',
  bodyField: 'function_body',
  paramsField: 'function_value_parameters',
  returnField: 'type',
  getSignature: (node, source) => {
    // Kotlin function signature: fun name(params): ReturnType
    const params = getChildByField(node, 'function_value_parameters');
    const returnType = getChildByField(node, 'type');
    if (!params) return undefined;
    let sig = getNodeText(params, source);
    if (returnType) {
      sig += ': ' + getNodeText(returnType, source);
    }
    return sig;
  },
  getVisibility: (node) => {
    // Check for visibility modifiers in Kotlin
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'modifiers') {
        const text = child.text;
        if (text.includes('public')) return 'public';
        if (text.includes('private')) return 'private';
        if (text.includes('protected')) return 'protected';
        if (text.includes('internal')) return 'internal';
      }
    }
    return 'public'; // Kotlin defaults to public
  },
  isStatic: (_node) => {
    // Kotlin doesn't have static, uses companion objects
    // Check if inside companion object would require more context
    return false;
  },
  isAsync: (node) => {
    // Kotlin uses suspend keyword for coroutines
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'modifiers' && child.text.includes('suspend')) {
        return true;
      }
    }
    return false;
  },
  extractImport: (node, source) => {
    const importText = source.substring(node.startIndex, node.endIndex).trim();
    const identifier = node.namedChildren.find((c: SyntaxNode) => c.type === 'identifier');
    if (identifier) {
      return { moduleName: source.substring(identifier.startIndex, identifier.endIndex), signature: importText };
    }
    return null;
  },
};
