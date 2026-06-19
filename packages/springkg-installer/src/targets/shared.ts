export function getMcpServerConfig(): Record<string, unknown> {
  return {
    type: 'stdio',
    command: 'springkg',
    args: ['serve', '--mcp'],
  };
}
