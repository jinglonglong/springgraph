import { computeId } from './internal/key-mask.js';

export interface SpringKgEnhanceInput {
  projectPath: string;
  kg: any;
}

export interface SpringKgEnhanceOutput {
  middlewareCount: number;
  edgesCount: number;
}

interface MiddlewareInfo {
  kind: string;
  name: string;
  qualifiedName: string;
  metadata: Record<string, any>;
}

/**
 * T16: MiddlewareInventory - infers middleware from config properties and creates CONNECTS_TO edges
 */
export class MiddlewareInventory {
  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const { kg } = input;

    // Get all runtime_config_properties
    let configProperties: any[] = [];
    try {
      configProperties = await kg.getConfigProperties ? await kg.getConfigProperties() : [];
    } catch (e) {
      return { middlewareCount: 0, edgesCount: 0 };
    }

    // Group by prefix to identify middleware
    const middlewareMap: Map<string, MiddlewareInfo> = new Map();
    const serviceMiddleware: Map<string, string[]> = new Map(); // serviceId -> middlewareIds

    for (const prop of configProperties) {
      const { serviceId, key, valueMasked } = prop;
      const middleware = this.inferMiddleware(key, valueMasked);
      if (middleware) {
        if (!middlewareMap.has(middleware.qualifiedName)) {
          middlewareMap.set(middleware.qualifiedName, middleware);
        }

        const mid = middlewareMap.get(middleware.qualifiedName)!;
        if (!serviceMiddleware.has(serviceId)) {
          serviceMiddleware.set(serviceId, []);
        }
        if (!serviceMiddleware.get(serviceId)!.includes(mid.qualifiedName)) {
          serviceMiddleware.get(serviceId)!.push(mid.qualifiedName);
        }
      }
    }

    let middlewareCount = 0;
    let edgesCount = 0;

    // Upsert middleware symbols
    for (const [, middleware] of middlewareMap) {
      try {
        await kg.upsertSymbol({
          id: computeId('middleware', middleware.qualifiedName),
          kind: 'middleware',
          name: middleware.name,
          qualifiedName: middleware.qualifiedName,
          filePath: '',
          startLine: 0,
          endLine: 0,
          metadata: middleware.metadata
        });
        middlewareCount++;
      } catch (e) {
        // May already exist
      }
    }

    // Upsert CONNECTS_TO edges
    for (const [serviceId, middlewareIds] of serviceMiddleware) {
      const microServiceId = computeId('micro_service', serviceId);

      for (const midQualifiedName of middlewareIds) {
        const middlewareId = computeId('middleware', midQualifiedName);
        try {
          await kg.upsertEdge({
            id: computeId('edge', `${microServiceId}:${middlewareId}:CONNECTS_TO`),
            sourceId: microServiceId,
            targetId: middlewareId,
            kind: 'CONNECTS_TO',
            provenance: 'static',
            metadata: {}
          });
          edgesCount++;
        } catch (e) {
          // May already exist
        }
      }
    }

    return { middlewareCount, edgesCount };
  }

  private inferMiddleware(key: string, value: string): MiddlewareInfo | null {
    // Database middleware
    if (key.startsWith('spring.datasource.')) {
      const urlMatch = value.match(/jdbc:(mysql|postgresql|oracle|sqlserver):\/\/([^:]+):(\d+)\/(.+)/);
      if (urlMatch) {
        const [, subtype, host, port] = urlMatch;
        // Extract datasource name from key (e.g., "order" from "spring.datasource.order.url")
        const keyParts = key.split('.');
        const datasourceName = keyParts.length > 3 ? keyParts[2] : null;
        const qualifiedName = datasourceName
          ? `spring.datasource.${subtype}.${datasourceName}`
          : `spring.datasource.${subtype}`;
        return {
          kind: 'database',
          name: datasourceName ? `${subtype} (${datasourceName})` : `${subtype} (${host}:${port})`,
          qualifiedName,
          metadata: { middlewareKind: 'database', subtype, host, port, url: value, datasourceName }
        };
      }
      // Just datasource without URL
      if (key === 'spring.datasource.url') {
        return {
          kind: 'database',
          name: 'database',
          qualifiedName: 'spring.datasource',
          metadata: { middlewareKind: 'database', subtype: 'unknown', url: value }
        };
      }
    }

    // Redis
    if (key.startsWith('spring.redis.')) {
      return {
        kind: 'cache',
        name: 'redis',
        qualifiedName: 'spring.redis',
        metadata: { middlewareKind: 'cache', subtype: 'redis' }
      };
    }

    // Kafka
    if (key.startsWith('spring.kafka.')) {
      const hostMatch = value.match(/([^:]+):(\d+)/);
      return {
        kind: 'mq',
        name: 'kafka',
        qualifiedName: 'spring.kafka',
        metadata: { middlewareKind: 'mq', subtype: 'kafka', bootstrapServers: value, host: hostMatch?.[1], port: hostMatch?.[2] }
      };
    }

    // RabbitMQ
    if (key.startsWith('spring.rabbitmq.')) {
      return {
        kind: 'mq',
        name: 'rabbitmq',
        qualifiedName: 'spring.rabbitmq',
        metadata: { middlewareKind: 'mq', subtype: 'rabbitmq' }
      };
    }

    // Elasticsearch
    if (key.startsWith('spring.elasticsearch.')) {
      return {
        kind: 'search',
        name: 'elasticsearch',
        qualifiedName: 'spring.elasticsearch',
        metadata: { middlewareKind: 'search', subtype: 'elasticsearch' }
      };
    }

    // XXL-Job
    if (key.startsWith('xxl.job.')) {
      return {
        kind: 'job_scheduler',
        name: 'xxl-job',
        qualifiedName: 'xxl.job',
        metadata: { middlewareKind: 'job_scheduler', subtype: 'xxl-job', adminAddresses: value }
      };
    }

    // MinIO / OSS
    if (key.startsWith('minio.') || key.startsWith('oss.')) {
      const subtype = key.startsWith('minio.') ? 'minio' : 'oss';
      return {
        kind: 'object_storage',
        name: subtype,
        qualifiedName: subtype,
        metadata: { middlewareKind: 'object_storage', subtype }
      };
    }

    return null;
  }
}
