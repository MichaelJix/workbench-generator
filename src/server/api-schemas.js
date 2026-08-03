import { z } from 'zod';
import { AppError, ErrorCode } from '../core/errors.js';

const username = z.string().regex(/^[A-Za-z0-9_.-]{3,64}$/);
const password = z.string().min(12).max(1024);
const note = z.string().max(200).optional();

export const ApiSchemas = Object.freeze({
  credentials: z.object({ username, password }).strict(),
  createUser: z.object({ username, password, role: z.enum(['admin', 'user']).default('user') }).strict(),
  interview: z.object({ prompt: z.string().min(1).max(2000) }).strict(),
  answers: z.object({ answers: z.record(z.unknown()) }).strict(),
  createWorkbench: z.object({ spec: z.unknown() }).strict(),
  reviseWorkbench: z.object({ patch: z.record(z.unknown()), note }).strict(),
  replaceWorkbench: z.object({ spec: z.unknown(), note }).strict(),
  rollback: z.object({ version: z.number().int().min(1) }).strict(),
  requestAction: z.object({ workbenchId: z.string().uuid(), actionId: z.string().min(1).max(64), input: z.record(z.unknown()).default({}) }).strict(),
  approval: z.object({ approvalToken: z.string().min(20).max(512) }).strict(),
  empty: z.object({}).strict()
});

export function parseApiInput(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(ErrorCode.INVALID_INPUT, '请求参数校验失败', result.error.issues.map((issue) => ({
      path: issue.path.join('.'), message: issue.message
    })));
  }
  return result.data;
}
