import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor } from '../tree-sitter-types';

export const goExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration'],
  classTypes: [], // Go doesn't have classes
  methodTypes: ['method_declaration'],
  interfaceTypes: ['interface_type'],
  structTypes: ['struct_type'],
  enumTypes: [],
  typeAliasTypes: ['type_spec'], // Go type declarations
  importTypes: ['import_declaration'],
  callTypes: ['call_expression'],
  variableTypes: ['var_declaration', 'short_var_declaration', 'const_declaration'],
  methodsAreTopLevel: true,
  nameField: 'name',
  bodyField: 'body',
  paramsField: 'parameters',
  returnField: 'result',
  getSignature: (node, source) => {
    const params = getChildByField(node, 'parameters');
    const result = getChildByField(node, 'result');
    if (!params) return undefined;
    let sig = getNodeText(params, source);
    if (result) {
      sig += ' ' + getNodeText(result, source);
    }
    return sig;
  },
};
