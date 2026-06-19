import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ConfigResolver } from '../src/config-resolver.js';

function createMockKg() {
  const symbols: any[] = [];
  const edges: any[] = [];
  const configProperties: any[] = [];

  return {
    symbols,
    edges,
    configProperties,
    upsertSymbol: async (symbol: any) => {
      const existing = symbols.findIndex(s => s.id === symbol.id);
      if (existing >= 0) {
        symbols[existing] = symbol;
      } else {
        symbols.push(symbol);
      }
    },
    upsertEdge: async (edge: any) => {
      const existing = edges.findIndex(e => e.id === edge.id);
      if (existing >= 0) {
        edges[existing] = edge;
      } else {
        edges.push(edge);
      }
    },
    recordConfigProperty: async (prop: any) => {
      const existing = configProperties.findIndex(c => c.id === prop.id);
      if (existing >= 0) {
        configProperties[existing] = prop;
      } else {
        configProperties.push(prop);
      }
    },
    getConfigProperties: async () => configProperties
  };
}

function createFixtureDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'springkg-test-'));
}

function createApplicationYml(dir: string, content: string) {
  const resourcesDir = path.join(dir, 'src', 'main', 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, 'application.yml'), content);
}

describe('ConfigResolver', () => {
  let resolver: ConfigResolver;

  beforeEach(() => {
    resolver = new ConfigResolver();
  });

  it('case 1: Basic application.yml with 4 keys -> 4 properties, all is_sensitive=0', async () => {
    const dir = createFixtureDir();
    createApplicationYml(dir, `
spring:
  application:
    name: test-service
  datasource:
    url: jdbc:mysql://localhost:3306/test
server:
  port: 8080
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.configPropertiesCount).toBe(3);
    expect(kg.configProperties.every(p => !p.isSensitive)).toBe(true);
  });

  it('case 2: spring.datasource.password=secret1234 -> value_masked=***1234, is_sensitive=1', async () => {
    const dir = createFixtureDir();
    createApplicationYml(dir, `
spring:
  application:
    name: test-service
  datasource:
    password: secret1234
server:
  port: 8080
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const passwordProp = kg.configProperties.find(p => p.key === 'spring.datasource.password');
    expect(passwordProp).toBeDefined();
    expect(passwordProp.valueMasked).toBe('***1234');
    expect(passwordProp.isSensitive).toBe(1);
  });

  it('case 3: application-dev.yml overrides application.yml -> higher priority (25 vs 50), correct value wins', async () => {
    const dir = createFixtureDir();
    const resourcesDir = path.join(dir, 'src', 'main', 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(resourcesDir, 'application.yml'), `
spring:
  application:
    name: test-service
server:
  port: 8080
`);
    fs.writeFileSync(path.join(resourcesDir, 'application-dev.yml'), `
spring:
  application:
    name: test-service
server:
  port: 8081
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const portProp = kg.configProperties.find(p => p.key === 'server.port');
    expect(portProp).toBeDefined();
    // Profile-specific (25) should override base (50) for same file set
    expect(portProp.valueMasked).toBe('8081');
  });

  it('case 4: bootstrap.yml overrides application.yml -> priority 100 wins', async () => {
    const dir = createFixtureDir();
    const resourcesDir = path.join(dir, 'src', 'main', 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(resourcesDir, 'application.yml'), `
spring:
  application:
    name: test-service
server:
  port: 8080
`);
    fs.writeFileSync(path.join(resourcesDir, 'bootstrap.yml'), `
spring:
  application:
    name: test-service
server:
  port: 9090
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const portProp = kg.configProperties.find(p => p.key === 'server.port');
    expect(portProp).toBeDefined();
    expect(portProp.valueMasked).toBe('9090');
  });

  it('case 5: application.properties (legacy) parses correctly', async () => {
    const dir = createFixtureDir();
    const resourcesDir = path.join(dir, 'src', 'main', 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    fs.writeFileSync(path.join(resourcesDir, 'application.properties'), `
spring.application.name=test-service
server.port=8080
spring.datasource.url=jdbc:mysql://localhost:3306/test
`);

    const kg = createMockKg();
    const result = await resolver.enhance({ projectPath: dir, kg });

    expect(result.configPropertiesCount).toBe(3);
  });

  it('case 6: Unknown keys still get written to runtime_config_properties (no key allowlist)', async () => {
    const dir = createFixtureDir();
    createApplicationYml(dir, `
spring:
  application:
    name: test-service
  unknown:
    custom:
      key: value
server:
  port: 8080
`);

    const kg = createMockKg();
    await resolver.enhance({ projectPath: dir, kg });

    const unknownProp = kg.configProperties.find(p => p.key === 'spring.unknown.custom.key');
    expect(unknownProp).toBeDefined();
    expect(unknownProp.valueMasked).toBe('value');
  });
});
