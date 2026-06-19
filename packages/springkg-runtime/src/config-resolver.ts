import { createHash } from 'node:crypto';
import { loadConfigFiles } from './internal/yaml-loader.js';
import { flattenProperties } from './internal/property-flatten.js';
import { maskValue, computeId } from './internal/key-mask.js';

export interface SpringKgEnhanceInput {
  projectPath: string;
  kg: any; // SpringKg instance from Team A
}

export interface SpringKgEnhanceOutput {
  configPropertiesCount: number;
  symbolsCount: number;
  edgesCount: number;
}

/**
 * T15: ConfigResolver - scans YAML/properties files and records config properties
 */
export class ConfigResolver {
  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const { projectPath, kg } = input;

    // Load all config files
    const configFiles = await loadConfigFiles(projectPath);
    if (configFiles.length === 0) {
      return { configPropertiesCount: 0, symbolsCount: 0, edgesCount: 0 };
    }

    // Group properties by serviceId
    const serviceConfigs: Map<string, Map<string, { value: any, file: string, priority: number, profile?: string }>> = new Map();

    for (const file of configFiles) {
      const flat = flattenProperties(file.content);

      // Extract service ID
      let serviceId = flat['spring.application.name'];
      if (!serviceId) {
        serviceId = 'unknown-service';
      }

      if (!serviceConfigs.has(serviceId)) {
        serviceConfigs.set(serviceId, new Map());
      }
      const config = serviceConfigs.get(serviceId)!;

      for (const [key, value] of Object.entries(flat)) {
        // Skip keys that are objects (not leaf values)
        if (value === null || typeof value === 'object') continue;

        const existing = config.get(key);
        // Override if: no existing, OR incoming is profile-specific (overrides non-profile),
        // OR same profile with higher priority number
        if (!existing ||
            (!existing.profile && file.profile) ||
            (file.profile === existing.profile && file.priority > existing.priority)) {
          config.set(key, {
            value: String(value),
            file: file.path,
            priority: file.priority,
            profile: file.profile
          });
        }
      }
    }

    let configPropertiesCount = 0;
    let symbolsCount = 0;
    let edgesCount = 0;

    // Process each service
    for (const [serviceId, properties] of serviceConfigs) {
      // Ensure micro_service symbol exists
      const microServiceId = computeId('micro_service', serviceId);
      try {
        await kg.upsertSymbol({
          id: microServiceId,
          kind: 'micro_service',
          name: serviceId,
          qualifiedName: serviceId,
          filePath: '',
          startLine: 0,
          endLine: 0,
          metadata: { stub: true }
        });
      } catch (e) {
        // May already exist
      }

      // Process each property
      for (const [key, { value, file, priority, profile }] of properties) {
        const { masked, isSensitive } = maskValue(key, value);

        // Compute hash for value
        const valueHash = 'sha256:' + createHash('sha256').update(value).digest('hex');

        // Record config property
        try {
          await kg.recordConfigProperty({
            id: computeId('config_property', `${serviceId}:${key}`),
            serviceId,
            key,
            valueMasked: masked,
            valueHash,
            valueType: typeof value,
            sourceFile: file,
            profile: profile || 'default',
            priority,
            isSensitive: isSensitive ? 1 : 0,
            metadata: {}
          });
          configPropertiesCount++;
        } catch (e) {
          // May already exist
        }

        // Upsert config_property symbol
        try {
          await kg.upsertSymbol({
            id: computeId('config_property', `${serviceId}:${key}`),
            kind: 'config_property',
            name: key,
            qualifiedName: key,
            filePath: file,
            startLine: 0,
            endLine: 0,
            metadata: { key, profile: profile || 'default', sourceFile: file }
          });
          symbolsCount++;
        } catch (e) {
          // May already exist
        }

        // Upsert LOADS_CONFIG edge from micro_service to config_property
        try {
          await kg.upsertEdge({
            id: computeId('edge', `${microServiceId}:${computeId('config_property', `${serviceId}:${key}`)}:LOADS_CONFIG`),
            sourceId: microServiceId,
            targetId: computeId('config_property', `${serviceId}:${key}`),
            kind: 'LOADS_CONFIG',
            provenance: 'static',
            metadata: { viaConfig: key }
          });
          edgesCount++;
        } catch (e) {
          // May already exist
        }
      }
    }

    return { configPropertiesCount, symbolsCount, edgesCount };
  }
}
