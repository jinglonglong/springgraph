import { describe, expect, it, beforeEach } from 'vitest';

import { ConfigResolver } from '../src/config-resolver';

describe('ConfigResolver', () => {
  let resolver: ConfigResolver;

  beforeEach(() => {
    resolver = new ConfigResolver();
  });

  it('extracts basic key-value properties', () => {
    resolver.addConfigFile('application.yml', 'app: myapp\nversion: 1.0');
    const result = resolver.resolve();
    expect(result.configProperties).toHaveLength(2);
    expect(result.configProperties.some((p: any) => p.key === 'app')).toBe(true);
    expect(result.configProperties.some((p: any) => p.key === 'version')).toBe(true);
  });

  it('marks sensitive properties correctly', () => {
    resolver.addConfigFile(
      'application.yml',
      'db.password=secret\ndb.username=admin'
    );
    const result = resolver.resolve();
    const password = result.configProperties.find((p: any) => p.key === 'db.password');
    const username = result.configProperties.find((p: any) => p.key === 'db.username');
    expect(password?.isSensitive).toBe(true);
    expect(username?.isSensitive).toBe(false);
  });

  it('higher priority file wins for same key', () => {
    resolver.addConfigFile('application.yml', 'port: 8080', undefined, 1);
    resolver.addConfigFile('application-dev.yml', 'port: 9090', 'dev', 2);

    const result = resolver.resolve();
    const port = result.configProperties.find((p: any) => p.key === 'port');
    expect(port?.sourceFilePath).toBe('application-dev.yml');
  });

  it('does not override higher priority with lower priority', () => {
    resolver.addConfigFile('application.yml', 'port: 8080', undefined, 5);
    resolver.addConfigFile('application-local.yml', 'port: 3000', 'local', 1);

    const result = resolver.resolve();
    const port = result.configProperties.find((p: any) => p.key === 'port');
    expect(port?.sourceFilePath).toBe('application.yml');
  });

  it('handles profile-specific configs', () => {
    resolver.addConfigFile('application.yml', 'db: localhost', 'default', 0);
    resolver.addConfigFile('application-prod.yml', 'db: prod.db.com', 'prod', 10);

    const result = resolver.resolve();
    const props = result.configProperties.filter((p: any) => p.key === 'db');
    expect(props).toHaveLength(2);
  });

  it('handles both YAML and properties format', () => {
    resolver.addConfigFile(
      'application.yml',
      'spring:\n  app: test-app'
    );
    resolver.addConfigFile(
      'application.properties',
      'spring.app=props-app'
    );

    const result = resolver.resolve();
    expect(result.configProperties).toHaveLength(2);
  });
});
