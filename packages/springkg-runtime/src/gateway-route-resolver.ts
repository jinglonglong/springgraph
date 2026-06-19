import { loadConfigFiles } from './internal/yaml-loader.js';
import { flattenProperties } from './internal/property-flatten.js';
import { computeId } from './internal/key-mask.js';

export interface SpringKgEnhanceInput {
  projectPath: string;
  kg: any;
}

export interface SpringKgEnhanceOutput {
  routesCount: number;
  routesToEdges: number;
  matchesPathEdges: number;
}

interface GatewayRoute {
  id: string;
  uri: string;
  predicates: string[];
  filters: string[];
  metadata: Record<string, any>;
}

/**
 * T39: GatewayRouteResolver - parses Spring Cloud Gateway routes
 */
export class GatewayRouteResolver {
  async enhance(input: SpringKgEnhanceInput): Promise<SpringKgEnhanceOutput> {
    const { projectPath, kg } = input;

    const configFiles = await loadConfigFiles(projectPath);
    const routes: GatewayRoute[] = [];
    const serviceNames: Set<string> = new Set();

    for (const file of configFiles) {
      const flat = flattenProperties(file.content);

      // Get spring.application.name to check if this is a gateway service
      const serviceName = flat['spring.application.name'];
      if (serviceName) {
        serviceNames.add(serviceName);
      }

      // Check if this file has gateway routes
      const hasGatewayKey = Object.keys(flat).some(k => k === 'spring.cloud.gateway' || k.startsWith('spring.cloud.gateway.'));
      const hasGateway = hasGatewayKey || (serviceName && serviceName.endsWith('-gateway'));
      if (!hasGateway) continue;

      // Extract routes
      const routesPrefix = 'spring.cloud.gateway.routes';
      const routeKeys: string[] = [];

      // Find all route IDs
      for (const [key] of Object.entries(flat)) {
        if (key.startsWith(routesPrefix) && key.endsWith('.id')) {
          routeKeys.push(key.replace('.id', ''));
        }
      }

      // Also check for array-style routes (spring.cloud.gateway.routes[0].id)
      for (const [key] of Object.entries(flat)) {
        const arrayMatch = key.match(/^spring\.cloud\.gateway\.routes\[(\d+)\]\.id$/);
        if (arrayMatch) {
          const routeBase = `spring.cloud.gateway.routes[${arrayMatch[1]}]`;
          if (!routeKeys.includes(routeBase)) {
            routeKeys.push(routeBase);
          }
        }
      }

      for (const routeBase of routeKeys) {
        const routeId = flat[`${routeBase}.id`];
        if (!routeId) continue;

        const uri = flat[`${routeBase}.uri`];
        if (!uri) continue;

        // Collect predicates
        const predicates: string[] = [];
        const predicatesPrefix = `${routeBase}.predicates`;
        for (const [key, value] of Object.entries(flat)) {
          if (key.startsWith(predicatesPrefix)) {
            predicates.push(String(value));
          }
        }

        // Collect filters
        const filters: string[] = [];
        const filtersPrefix = `${routeBase}.filters`;
        for (const [key, value] of Object.entries(flat)) {
          if (key.startsWith(filtersPrefix)) {
            filters.push(String(value));
          }
        }

        routes.push({
          id: routeId,
          uri,
          predicates,
          filters,
          metadata: { predicates, filters }
        });
      }
    }

    let routesCount = 0;
    let routesToEdges = 0;
    let matchesPathEdges = 0;

    for (const route of routes) {
      const routeId = computeId('gateway_route', route.id);

      // Upsert gateway_route symbol
      try {
        await kg.upsertSymbol({
          id: routeId,
          kind: 'gateway_route',
          name: route.id,
          qualifiedName: route.id,
          filePath: '',
          startLine: 0,
          endLine: 0,
          metadata: {
            uri: route.uri,
            predicates: route.predicates,
            filters: route.filters
          }
        });
        routesCount++;
      } catch (e) {}

      // Determine target type and create ROUTES_TO edge
      let targetId: string;

      if (route.uri.startsWith('lb://')) {
        const serviceName = route.uri.slice(4);
        targetId = computeId('micro_service', serviceName);

        // Create stub micro_service if not exists
        try {
          await kg.upsertSymbol({
            id: targetId,
            kind: 'micro_service',
            name: serviceName,
            qualifiedName: serviceName,
            filePath: '',
            startLine: 0,
            endLine: 0,
            metadata: { stub: true }
          });
        } catch (e) {}
      } else if (route.uri.startsWith('http://') || route.uri.startsWith('https://')) {
        const url = new URL(route.uri);
        const host = url.host;
        targetId = computeId('route_target', `external:${host}`);

        // Create route_target symbol
        try {
          await kg.upsertSymbol({
            id: targetId,
            kind: 'route_target',
            name: host,
            qualifiedName: route.uri,
            filePath: '',
            startLine: 0,
            endLine: 0,
            metadata: { externalUri: route.uri, host }
          });
        } catch (e) {}
      } else if (route.uri.startsWith('ws://') || route.uri.startsWith('wss://')) {
        const url = new URL(route.uri);
        targetId = computeId('route_target', `external:${url.host}:websocket`);

        try {
          await kg.upsertSymbol({
            id: targetId,
            kind: 'route_target',
            name: url.host,
            qualifiedName: route.uri,
            filePath: '',
            startLine: 0,
            endLine: 0,
            metadata: { externalUri: route.uri, host: url.host, websocket: true }
          });
        } catch (e) {}
      } else {
        // Unknown URI scheme, skip
        console.warn(`[springkg] GatewayRouteResolver: unknown URI scheme "${route.uri}"`);
        continue;
      }

      // Create ROUTES_TO edge
      try {
        await kg.upsertEdge({
          id: computeId('edge', `${routeId}:${targetId}:ROUTES_TO`),
          sourceId: routeId,
          targetId,
          kind: 'ROUTES_TO',
          provenance: 'static',
          metadata: { uri: route.uri }
        });
        routesToEdges++;
      } catch (e) {}

      // Parse predicates for Path matches
      for (const predicate of route.predicates) {
        const pathMatch = predicate.match(/^Path\s*=\s*(.+)$/);
        if (pathMatch) {
          const path = pathMatch[1];
          // Extract service name from route id or use 'gateway'
          const serviceNameForEndpoint = route.id.replace(/-route$/, '');
          const endpointId = computeId('endpoint', `${serviceNameForEndpoint}:${path}`);

          // Create endpoint symbol if not exists (Team B may create this later)
          try {
            await kg.upsertSymbol({
              id: endpointId,
              kind: 'endpoint',
              name: path,
              qualifiedName: path,
              filePath: '',
              startLine: 0,
              endLine: 0,
              metadata: { path, service: serviceNameForEndpoint }
            });
          } catch (e) {}

          // Create MATCHES_PATH edge
          try {
            await kg.upsertEdge({
              id: computeId('edge', `${routeId}:${endpointId}:MATCHES_PATH`),
              sourceId: routeId,
              targetId: endpointId,
              kind: 'MATCHES_PATH',
              provenance: 'static',
              metadata: { path }
            });
            matchesPathEdges++;
          } catch (e) {}
        }
      }
    }

    return { routesCount, routesToEdges, matchesPathEdges };
  }
}
