import { Node, Edge } from '../../types';
import { ArchitectureContext, NodeArchitectureFacet, ArchitectureSignal } from '../types';

export interface SynthesizedEdge extends Edge {
  provenance: 'heuristic';
}

export interface AnnotationFact {
  adapterId: string;
  nodeId: string;
  kind:
    | 'bean'
    | 'injection'
    | 'mapping'
    | 'generated-method'
    | 'generated-property'
    | 'lifecycle'
    | 'sql-statement'
    | 'config-binding';
  name: string;
  targetNodeId?: string;
  metadata: Record<string, unknown>;
  confidence: number;
  evidence: ArchitectureSignal[];
}

export interface AnnotationAdapter {
  id: string;
  framework: string;
  supports(node: Node, context: ArchitectureContext): boolean;
  collectFacts(node: Node, context: ArchitectureContext): AnnotationFact[];
  synthesizeEdges?(fact: AnnotationFact, context: ArchitectureContext): SynthesizedEdge[];
  assignFacet?(fact: AnnotationFact, context: ArchitectureContext): Partial<NodeArchitectureFacet>[];
}

export interface RuleBasedAdapterRule {
  adapterId: string;
  annotation: string;
  produces: {
    role?: string;
    layer?: string;
    tags?: string[];
  };
}

export interface RuleBasedAdapter extends AnnotationAdapter {
  registerRule(rule: RuleBasedAdapterRule): void;
}

export class AnnotationAdapterRegistry {
  private adapters: AnnotationAdapter[] = [];

  register(adapter: AnnotationAdapter): void {
    this.adapters.push(adapter);
  }

  getAdapters(): AnnotationAdapter[] {
    return [...this.adapters];
  }

  getAdapter(id: string): AnnotationAdapter | undefined {
    return this.adapters.find(a => a.id === id);
  }

  clear(): void {
    this.adapters = [];
  }
}
