import { loadConfigFiles } from './internal/yaml-loader.js';
import { flattenProperties } from './internal/property-flatten.js';
import { maskValue, computeId } from './internal/key-mask.js';
import { logResolverWarning } from './types.js';
import type { SpringKgLike } from './types.js';

export interface SpringKgEnhanceInput {
  projectPath: string;
  kg: SpringKgLike;
}

export interface SpringKgEnhanceOutput {
  clustersCount: number;
  configsCount: number;
  servicesCount: number;
  edgesCount: number;
}

interface NacosCluster {
  serverAddr: string;
  namespace?: string;
  group?: string;
  username?: string;
  password?: string;
}

interface NacosConfig {
  dataId: string;
  group: string;
  namespace?: string;
  fileExtension?: string;
  refreshEnabled?: boolean;
}

/**
 * T37: NacosConfigResolver - extracts Nacos clusters, configs, and services
 */
export class NacosConfigResolver {
  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const { projectPath, kg } = input;

    const configFiles = await loadConfigFiles(projectPath);
    if (configFiles.length === 0) {
      return { clustersCount: 0, configsCount: 0, servicesCount: 0, edgesCount: 0 };
    }

    const clusters: Map<string, NacosCluster> = new Map();
    const configs: NacosConfig[] = [];
    const services: Set<string> = new Set();

    for (const file of configFiles) {
      const flat = flattenProperties(file.content);

      // Extract service name
      const serviceName = flat['spring.application.name'];
      if (serviceName) {
        services.add(serviceName);
      }

      // Extract Nacos discovery config
      const discoveryServerAddr = flat['spring.cloud.nacos.discovery.server-addr'];
      if (discoveryServerAddr) {
        const namespace = flat['spring.cloud.nacos.discovery.namespace'];
        const group = flat['spring.cloud.nacos.discovery.group'];
        const username = flat['spring.cloud.nacos.discovery.username'];
        const password = flat['spring.cloud.nacos.discovery.password'];

        const { masked } = maskValue('nacos.password', password);
        clusters.set(discoveryServerAddr, {
          serverAddr: discoveryServerAddr,
          namespace,
          group,
          username,
          password: masked
        });
      }

      // Extract Nacos config
      const configNamespace = flat['spring.cloud.nacos.config.namespace'] || flat['spring.cloud.nacos.discovery.namespace'];
      const configGroup = flat['spring.cloud.nacos.config.group'] || 'DEFAULT_GROUP';

      // Extension configs
      const extConfigPrefix = 'spring.cloud.nacos.config.ext-config';
      for (const [key, value] of Object.entries(flat)) {
        if (key.startsWith(extConfigPrefix) && key.endsWith('.data-id')) {
          configs.push({
            dataId: value as string,
            group: (flat[key.replace('.data-id', '.group')] as string) || configGroup,
            namespace: configNamespace,
            fileExtension: (flat[key.replace('.data-id', '.file-extension')] as string) || 'properties'
          });
        }
      }

      // Shared configs
      const sharedConfigPrefix = 'spring.cloud.nacos.config.shared-configs';
      for (const [key, value] of Object.entries(flat)) {
        if (key.startsWith(sharedConfigPrefix) && key.endsWith('.data-id')) {
          configs.push({
            dataId: value as string,
            group: (flat[key.replace('.data-id', '.group')] as string) || configGroup,
            namespace: configNamespace,
            fileExtension: (flat[key.replace('.data-id', '.file-extension')] as string) || 'properties'
          });
        }
      }

      // spring.config.import=nacos: syntax
      const importValue = flat['spring.config.import'];
      if (typeof importValue === 'string' && importValue.startsWith('nacos:')) {
        const nacosPart = importValue.slice(6); // Remove 'nacos:' prefix
        const [dataIdPart, queryString] = nacosPart.split('?');
        const dataId = dataIdPart;

        let group = configGroup;
        let namespace = configNamespace;
        let refreshEnabled: boolean | undefined;

        if (queryString) {
          const params = new URLSearchParams(queryString);
          group = params.get('group') || group;
          namespace = params.get('namespace') || namespace;
          refreshEnabled = params.get('refreshEnabled') === 'true';
        }

        configs.push({
          dataId: dataId || 'unknown',
          group,
          namespace,
          fileExtension: dataId && dataId.includes('.') ? (dataId.split('.').pop() ?? 'properties') : 'properties',
          refreshEnabled
        });
      }

      // Implicit dataId from spring.application.name + file-extension
      if (serviceName && flat['spring.cloud.nacos.config.file-extension']) {
        configs.push({
          dataId: `${serviceName}.${flat['spring.cloud.nacos.config.file-extension']}`,
          group: configGroup,
          namespace: configNamespace,
          fileExtension: flat['spring.cloud.nacos.config.file-extension']
        });
      }
    }

    let clustersCount = 0;
    let configsCount = 0;
    let servicesCount = 0;
    let edgesCount = 0;

    // Upsert nacos_cluster symbols
    for (const [serverAddr, cluster] of clusters) {
      const clusterId = computeId('nacos_cluster', serverAddr);
      try {
        await kg.upsertSymbol({
          id: clusterId,
          kind: 'nacos_cluster',
          name: serverAddr,
          qualifiedName: serverAddr,
          filePath: '',
          startLine: 0,
          endLine: 0,
          metadata: {
            namespace: cluster.namespace,
            group: cluster.group,
            username: cluster.username,
            password: cluster.password
          }
        });
        clustersCount++;
      } catch (error) {
        logResolverWarning('NacosConfigResolver', `failed to upsert nacos_cluster ${serverAddr}`, error);
      }

      // Link service to cluster
      for (const serviceName of services) {
        const serviceId = computeId('nacos_service', serviceName);
        const microServiceId = computeId('micro_service', serviceName);

        // Ensure nacos_service exists
        try {
          await kg.upsertSymbol({
            id: serviceId,
            kind: 'nacos_service',
            name: serviceName,
            qualifiedName: serviceName,
            filePath: '',
            startLine: 0,
            endLine: 0,
            metadata: { cluster: serverAddr, group: cluster.group }
          });
          servicesCount++;
        } catch (error) {
          logResolverWarning('NacosConfigResolver', `failed to upsert nacos_service ${serviceName}`, error);
        }

        // LOADS_CONFIG edge
        try {
          await kg.upsertEdge({
            id: computeId('edge', `${microServiceId}:${serviceId}:LOADS_CONFIG`),
            sourceId: microServiceId,
            targetId: serviceId,
            kind: 'LOADS_CONFIG',
            provenance: 'static',
            metadata: { viaCluster: serverAddr }
          });
          edgesCount++;
        } catch (error) {
          logResolverWarning('NacosConfigResolver', `failed to create LOADS_CONFIG edge for ${serviceName}`, error);
        }
      }
    }

    // Upsert nacos_config symbols
    const seenConfigs = new Set<string>();
    for (const config of configs) {
      const configKey = `${config.group}:${config.dataId}`;
      if (seenConfigs.has(configKey)) continue;
      seenConfigs.add(configKey);

      const configId = computeId('nacos_config', configKey);
      try {
        await kg.upsertSymbol({
          id: configId,
          kind: 'nacos_config',
          name: config.dataId,
          qualifiedName: configKey,
          filePath: '',
          startLine: 0,
          endLine: 0,
          metadata: {
            group: config.group,
            namespace: config.namespace,
            fileExtension: config.fileExtension,
            refreshEnabled: config.refreshEnabled
          }
        });
        configsCount++;
      } catch (error) {
        logResolverWarning('NacosConfigResolver', `failed to upsert nacos_config ${configKey}`, error);
      }
    }

    return { clustersCount, configsCount, servicesCount, edgesCount };
  }
}
