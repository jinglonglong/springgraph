import { computeId } from './internal/key-mask.js';

export interface SpringKgEnhanceInput {
  projectPath: string;
  kg: any;
}

export interface SpringKgEnhanceOutput {
  edgesCount: number;
}

/**
 * T38: ConfigPropertyUsageTracker - links @Value and @ConfigurationProperties to config properties
 */
export class ConfigPropertyUsageTracker {
  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const { kg } = input;

    let edgesCount = 0;

    // Get nodes with @Value or @ConfigurationProperties decorators
    let decoratedNodes: any[] = [];
    try {
      if (kg.codegraph?.findNodes) {
        decoratedNodes = await kg.codegraph.findNodes({
          decoratorPattern: '@Value|@ConfigurationProperties'
        });
      }
    } catch (e) {
      // Fallback: try to get from kg directly
      try {
        decoratedNodes = await kg.findDecoratedNodes?.() || [];
      } catch (err) {
        return { edgesCount: 0 };
      }
    }

    // Get runtime_config_properties for matching
    let configProperties: any[] = [];
    try {
      configProperties = await kg.getConfigProperties?.() || [];
    } catch (e) {
      configProperties = [];
    }

    // Build a map of serviceId:key -> configPropertyId
    const configPropMap = new Map<string, string>();
    for (const prop of configProperties) {
      const key = `${prop.serviceId}:${prop.key}`;
      configPropMap.set(key, prop.id || computeId('config_property', key));
    }

    // Process each decorated node
    for (const node of decoratedNodes) {
      const { decorators, id: nodeId, name: nodeName, kind: nodeKind } = node;

      // Match @Value("${...}")
      const valuePattern = /@Value\s*\(\s*"\$\{([^}]+)\}"/g;
      let match;
      while ((match = valuePattern.exec(decorators)) !== null) {
        const configKey = match[1];
        const serviceId = node.serviceId || 'unknown-service';
        const configPropertyKey = `${serviceId}:${configKey}`;

        const configPropertyId = configPropMap.get(configPropertyKey);
        if (!configPropertyId) {
          // Log warning - key not found in runtime_config_properties
          console.warn(`[springkg] ConfigPropertyUsageTracker: @Value key "${configKey}" not found in runtime_config_properties for service "${serviceId}"`);
          continue;
        }

        // Create USED_BY edge
        try {
          await kg.upsertEdge({
            id: computeId('edge', `${configPropertyId}:${nodeId}:USED_BY`),
            sourceId: configPropertyId,
            targetId: nodeId,
            kind: 'USED_BY',
            provenance: 'static',
            metadata: {
              usageKind: 'Value',
              targetKind: nodeKind,
              targetName: nodeName
            }
          });
          edgesCount++;
        } catch (e) {}
      }

      // Match @ConfigurationProperties(prefix = "...")
      const configPropPattern = /@ConfigurationProperties\s*\(\s*(?:prefix\s*=\s*)?["']([^"']+)["']/gi;
      while ((match = configPropPattern.exec(decorators)) !== null) {
        const prefix = match[1];
        if (!prefix) continue;

        // Find all config properties with this prefix
        for (const [key, configPropertyId] of configPropMap) {
          if (key.endsWith(prefix) || key.includes(prefix + '.')) {
            try {
              await kg.upsertEdge({
                id: computeId('edge', `${configPropertyId}:${nodeId}:USED_BY`),
                sourceId: configPropertyId,
                targetId: nodeId,
                kind: 'USED_BY',
                provenance: 'static',
                metadata: {
                  usageKind: 'ConfigurationProperties',
                  targetKind: nodeKind,
                  targetName: nodeName,
                  prefix
                }
              });
              edgesCount++;
            } catch (e) {}
          }
        }
      }
    }

    return { edgesCount };
  }
}
