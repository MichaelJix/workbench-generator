import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP server lists tools and returns structured Spec output', async () => {
  const client = new Client({ name: 'workbench-generator-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/mcp/server.mjs'],
    cwd: process.cwd()
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name), [
      'scaffold_workbench', 'build_workbench', 'list_connectors',
      'interview_workbench', 'build_spec', 'introspect_sample'
    ]);
    const listTool = listed.tools.find((tool) => tool.name === 'list_connectors');
    const scaffoldTool = listed.tools.find((tool) => tool.name === 'scaffold_workbench');
    assert.equal(listTool.annotations.readOnlyHint, true);
    assert.equal(scaffoldTool.annotations.destructiveHint, true);
    assert.equal(Boolean(listTool.outputSchema), true);
    const result = await client.callTool({
      name: 'build_spec',
      arguments: { prompt: '做一个 Stripe 余额看板', answers: { auth: 'bearer' } }
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.result.connector.baseUrl, 'https://api.stripe.com/v1');
  } finally {
    await client.close();
  }
});
