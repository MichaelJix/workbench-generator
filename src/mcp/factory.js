import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { scaffold, buildWorkbench, slugify } from '../core/generator.js';
import { WorkbenchSpecSchema } from '../core/spec.js';
import { listConnectors } from '../core/connectors/index.js';
import { analyzePrompt, buildSpec, introspectSample } from '../core/interview.js';
import { AppError, ErrorCode } from '../core/errors.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const text = (value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];
const safe = (handler) => async (args, context) => {
  try { return await handler(args, context); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code || 'INTERNAL', message: error.message }) }] }; }
};
const result = (value) => ({ content: text(value), structuredContent: { result: value } });
const output = { result: z.unknown() };

function requireScope(user, scope) {
  if (!user.scopes?.includes(scope) && !user.scopes?.includes('admin')) {
    throw new AppError(ErrorCode.FORBIDDEN, `缺少权限: ${scope}`);
  }
}

export function createMcpServer({ services, user, filesystemTools = true } = {}) {
  const server = new McpServer({ name: 'workbench-generator', version: '1.0.0' });

  if (filesystemTools) {
    server.registerTool('scaffold_workbench', {
      description: '在当前工作区生成工作台，默认拒绝覆盖非空目录。',
      inputSchema: { spec: WorkbenchSpecSchema, outDir: z.string().min(1).max(512).optional(), overwrite: z.boolean().default(false) },
      outputSchema: output, annotations: mutating
    }, safe(async ({ spec, outDir, overwrite }) => result(scaffold(spec, outDir || `./${spec.slug || slugify(spec.name)}`, { overwrite }))));
    server.registerTool('build_workbench', {
      description: '使用内部固定构建逻辑构建生成项目。', inputSchema: { projectDir: z.string().min(1).max(512) },
      outputSchema: output, annotations: mutating
    }, safe(async ({ projectDir }, context) => result(await buildWorkbench(projectDir, { signal: context?.signal }))));
  }

  server.registerTool('list_connectors', {
    description: '列出连接器及能力。', inputSchema: {}, outputSchema: output, annotations: readOnly
  }, safe(async () => result(listConnectors())));
  server.registerTool('interview_workbench', {
    description: '分析一句话需求并返回结构化问题。', inputSchema: { prompt: z.string().min(1).max(2000) },
    outputSchema: output, annotations: readOnly
  }, safe(async ({ prompt }) => result(analyzePrompt(prompt))));
  server.registerTool('build_spec', {
    description: '把访谈答案转换为已校验 Spec。', inputSchema: { prompt: z.string().min(1).max(2000), answers: z.record(z.unknown()).default({}) },
    outputSchema: output, annotations: readOnly
  }, safe(async ({ prompt, answers }) => result(buildSpec(prompt, answers))));
  server.registerTool('introspect_sample', {
    description: '分析不超过 1MB 的 JSON 样本。', inputSchema: { json: z.string().max(1_000_000) },
    outputSchema: output, annotations: readOnly
  }, safe(async ({ json }) => {
    const value = introspectSample(json);
    if (value.error) throw new Error(value.error);
    return result(value);
  }));

  if (services && user) registerStatefulTools(server, services, user);
  return server;
}

function registerStatefulTools(server, services, user) {
  const scoped = (scope, handler) => safe(async (...args) => {
    requireScope(user, scope);
    return handler(...args);
  });
  server.registerTool('interview_start', {
    description: '创建持久化访谈会话。', inputSchema: { prompt: z.string().min(1).max(2000) }, outputSchema: output, annotations: mutating
  }, scoped('workbench:write', async ({ prompt }) => result(services.interviews.start(user, prompt))));
  server.registerTool('interview_answer', {
    description: '提交访谈答案。', inputSchema: { interviewId: z.string().uuid(), answers: z.record(z.unknown()) }, outputSchema: output, annotations: mutating
  }, scoped('workbench:write', async ({ interviewId, answers }) => result(services.interviews.answer(user, interviewId, answers))));
  server.registerTool('interview_finalize', {
    description: '完成访谈并创建版本化工作台。', inputSchema: { interviewId: z.string().uuid() }, outputSchema: output, annotations: mutating
  }, scoped('workbench:write', async ({ interviewId }) => result(services.interviews.finalize(user, interviewId))));
  server.registerTool('workbench_list', {
    description: '列出当前用户的工作台。', inputSchema: {}, outputSchema: output, annotations: readOnly
  }, scoped('workbench:read', async () => result(services.workbenches.list(user))));
  server.registerTool('workbench_get', {
    description: '读取工作台及当前 Spec。', inputSchema: { workbenchId: z.string().uuid() }, outputSchema: output, annotations: readOnly
  }, scoped('workbench:read', async ({ workbenchId }) => result(services.workbenches.get(user, workbenchId))));
  server.registerTool('workbench_revise', {
    description: '使用 JSON Merge Patch 创建工作台新版本。',
    inputSchema: { workbenchId: z.string().uuid(), patch: z.record(z.unknown()), note: z.string().max(200).default('mcp revision') },
    outputSchema: output, annotations: mutating
  }, scoped('workbench:write', async ({ workbenchId, patch, note }) => result(services.workbenches.revise(user, workbenchId, patch, note))));
  server.registerTool('action_request', {
    description: '创建外部写操作审批请求，不会立即执行。',
    inputSchema: { workbenchId: z.string().uuid(), actionId: z.string(), input: z.record(z.unknown()).default({}) },
    outputSchema: output, annotations: mutating
  }, scoped('action:request', async (value) => result(services.actions.request(user, value))));
  server.registerTool('action_approve', {
    description: '批准写操作并返回一次性审批票据。', inputSchema: { actionRequestId: z.string().uuid() },
    outputSchema: output, annotations: mutating
  }, scoped('action:approve', async ({ actionRequestId }) => result(services.actions.approve(user, actionRequestId))));
  server.registerTool('action_execute', {
    description: '使用一次性票据执行已批准写操作。',
    inputSchema: { actionRequestId: z.string().uuid(), approvalToken: z.string().min(20) }, outputSchema: output, annotations: mutating
  }, scoped('action:approve', async ({ actionRequestId, approvalToken }) => result(await services.actions.execute(user, actionRequestId, approvalToken))));
}
