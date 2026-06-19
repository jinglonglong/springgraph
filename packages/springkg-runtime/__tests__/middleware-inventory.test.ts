import { describe, expect, it } from 'vitest';

import { inferMiddleware } from '../src/middleware-inventory';

const infer = (content: string) => inferMiddleware('application.yml', content);

describe('middleware-inventory', () => {
  it('extracts primary datasource from spring.datasource.url', () => {
    const out = infer('spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/mydb\n    driver-class-name: com.mysql.cj.jdbc.Driver\n    username: root\n');
    const ds = out.symbols.find((n) => n.name === 'primary');
    expect(ds).toBeDefined();
    expect(ds?.metadata?.url).toBe('jdbc:mysql://localhost:3306/mydb');
    expect(ds?.metadata?.driverClassName).toBe('com.mysql.cj.jdbc.Driver');
    expect(ds?.metadata?.username).toBe('root');
  });

  it('extracts order datasource from spring.datasource.order.url', () => {
    const out = infer('spring:\n  datasource:\n    order:\n      url: jdbc:mysql://localhost:3306/order_db\n      driver-class-name: com.mysql.cj.jdbc.Driver\n      username: order_user\n');
    const ds = out.symbols.find((n) => n.name === 'order');
    expect(ds).toBeDefined();
    expect(ds?.metadata?.url).toBe('jdbc:mysql://localhost:3306/order_db');
    expect(ds?.metadata?.driverClassName).toBe('com.mysql.cj.jdbc.Driver');
    expect(ds?.metadata?.username).toBe('order_user');
  });

  it('extracts both primary and order data sources from the same file', () => {
    const out = infer(
      'spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/mydb\n    username: root\n    order:\n      url: jdbc:mysql://localhost:3306/order_db\n      username: order_user\n'
    );
    expect(out.symbols).toHaveLength(2);
    const primary = out.symbols.find((n) => n.name === 'primary');
    const order = out.symbols.find((n) => n.name === 'order');
    expect(primary?.metadata?.url).toBe('jdbc:mysql://localhost:3306/mydb');
    expect(order?.metadata?.url).toBe('jdbc:mysql://localhost:3306/order_db');
  });

  it('handles properties format (key=value)', () => {
    const out = inferMiddleware(
      'application.properties',
      'spring.datasource.url=jdbc:mysql://localhost:3306/mydb\nspring.datasource.order.url=jdbc:mysql://localhost:3306/order_db\n'
    );
    expect(out.symbols).toHaveLength(2);
  });

  it('returns empty symbols when no datasource is present', () => {
    const out = infer('spring:\n  application:\n    name: myapp\n');
    expect(out.symbols).toHaveLength(0);
  });

  it('marks middlewareType as datasource in metadata', () => {
    const out = infer('spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/mydb\n');
    const ds = out.symbols[0];
    expect(ds?.metadata?.middlewareType).toBe('datasource');
    expect(ds?.kind).toBe('middleware');
  });

  it('distinguishes between different file paths', () => {
    const out1 = inferMiddleware('application.yml', 'spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/db1\n');
    const out2 = inferMiddleware('application-order.yml', 'spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/db2\n');
    expect(out1.symbols[0]?.filePath).toBe('application.yml');
    expect(out2.symbols[0]?.filePath).toBe('application-order.yml');
  });

  it('handles datasource without username or driver', () => {
    const out = infer('spring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/mydb\n');
    const ds = out.symbols[0];
    expect(ds?.metadata?.url).toBe('jdbc:mysql://localhost:3306/mydb');
    expect(ds?.metadata?.username).toBeUndefined();
    expect(ds?.metadata?.driverClassName).toBeUndefined();
  });
});
