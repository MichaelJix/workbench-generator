import { z } from 'zod';
import { migrateSpec, CURRENT_SPEC_VERSION } from './spec-migrations.js';
import { AppError, ErrorCode } from './errors.js';

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,127}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_HEADER_RE = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$/i;

const id = z.string().regex(ID_RE, '必须是安全的标识符').max(64);
const fieldPath = z.string().min(1).max(256);
const primitive = z.union([z.string().max(2048), z.number().finite(), z.boolean()]);

const AuthSchema = z.object({
  mode: z.enum(['bearer', 'header', 'query']),
  env: z.string().regex(ENV_RE, '环境变量名不合法'),
  header: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  queryParam: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional()
}).strict().nullable();

const EndpointSchema = z.object({
  id,
  path: z.string().min(1).max(2048).refine((v) => v.startsWith('/'), 'endpoint.path 必须以 / 开头'),
  method: z.literal('GET').default('GET'),
  cacheTtl: z.number().int().min(0).max(86400).optional()
}).strict();

export const ActionDefinitionSchema = z.object({
  id,
  label: z.string().min(1).max(120),
  path: z.string().min(1).max(2048).refine((value) => value.startsWith('/'), 'action.path 必须以 / 开头'),
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  confirmation: z.string().min(1).max(300),
  input: z.array(z.object({
    name: id,
    label: z.string().min(1).max(120),
    type: z.enum(['string', 'number', 'boolean']),
    required: z.boolean().default(false)
  }).strict()).max(32).default([])
}).strict();

const RestConnectorSchema = z.object({
  type: z.literal('rest-apikey'),
  baseUrl: z.string().url().refine((v) => {
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  }, 'baseUrl 必须使用 HTTPS，且不得包含凭据、查询参数或 hash'),
  auth: AuthSchema.optional(),
  headers: z.record(z.string().max(1024)).optional().refine(
    (headers) => !headers || Object.keys(headers).every((name) => /^[A-Za-z0-9-]{1,64}$/.test(name) && !SECRET_HEADER_RE.test(name)),
    '静态 headers 名称不合法，或包含 Authorization、API Key、Token'
  ),
  endpoints: z.array(EndpointSchema).min(1).max(64),
  actions: z.array(ActionDefinitionSchema).max(32).optional()
}).strict();

const WechatConnectorSchema = z.object({
  type: z.literal('wechat-mp'),
  appidEnv: z.string().regex(ENV_RE).default('WECHAT_APPID'),
  secretEnv: z.string().regex(ENV_RE).default('WECHAT_SECRET'),
  account: z.string().max(120).optional()
}).strict();

const KpiSchema = z.object({
  type: z.literal('kpi'), label: z.string().min(1).max(120), endpoint: id, field: fieldPath,
  trend: z.string().max(120).optional(), params: z.record(primitive).optional()
}).strict();

const SeriesSchema = z.object({ name: z.string().min(1).max(80), field: fieldPath }).strict();
const StandardLineChartSchema = z.object({
  type: z.literal('lineChart'), title: z.string().max(120).optional(), endpoint: id,
  arrayField: z.string().max(256), xField: fieldPath, series: z.array(SeriesSchema).min(1).max(8),
  params: z.record(primitive).optional()
}).strict();
const ParallelLineChartSchema = z.object({
  type: z.literal('lineChart'), title: z.string().max(120).optional(), endpoint: id,
  mode: z.literal('parallel'),
  parallel: z.object({
    base: z.string().max(256).default(''), labels: fieldPath,
    series: z.record(fieldPath).refine((v) => Object.keys(v).length > 0, '至少需要一个序列')
  }).strict(),
  params: z.record(primitive).optional()
}).strict();

const ListSchema = z.object({
  type: z.literal('list'), title: z.string().max(120).optional(), endpoint: id,
  arrayField: z.string().max(256), titleField: fieldPath, subField: fieldPath.optional(),
  limit: z.number().int().min(1).max(200).optional(), params: z.record(primitive).optional()
}).strict();
const TableSchema = z.object({
  type: z.literal('table'), title: z.string().max(120).optional(), endpoint: id,
  arrayField: z.string().max(256), columns: z.array(z.object({
    title: z.string().min(1).max(80), field: fieldPath
  }).strict()).min(1).max(32),
  limit: z.number().int().min(1).max(500).optional(), params: z.record(primitive).optional()
}).strict();
const TextSchema = z.object({
  type: z.literal('text'), title: z.string().max(120).optional(), text: z.string().max(10000)
}).strict();

const WidgetSchema = z.union([
  KpiSchema, StandardLineChartSchema, ParallelLineChartSchema, ListSchema, TableSchema, TextSchema
]);
const PageSchema = z.object({
  id, title: z.string().min(1).max(120), widgets: z.array(WidgetSchema).min(1).max(100)
}).strict();

export const WorkbenchSpecSchema = z.object({
  specVersion: z.literal(CURRENT_SPEC_VERSION),
  name: z.string().min(1).max(160),
  slug: z.string().regex(SLUG_RE).max(80).optional(),
  theme: z.object({ brand: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }).strict().optional(),
  connector: z.union([RestConnectorSchema, WechatConnectorSchema]),
  params: z.record(primitive).optional(),
  pages: z.array(PageSchema).min(1).max(32)
}).strict();

function formatIssue(issue) {
  const p = issue.path.length ? issue.path.join('.') + ': ' : '';
  return p + issue.message;
}

export function validateSpec(spec) {
  let migrated;
  try { migrated = migrateSpec(spec).spec; }
  catch (error) { return { ok: false, errors: [error.message] }; }
  const parsed = WorkbenchSpecSchema.safeParse(migrated);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(formatIssue) };

  const errors = [];
  const pageIds = new Set();
  for (const page of parsed.data.pages) {
    if (pageIds.has(page.id)) errors.push(`重复的 page id: ${page.id}`);
    pageIds.add(page.id);
  }

  const endpointIds = parsed.data.connector.type === 'wechat-mp'
    ? new Set(['overview', 'status', 'connect'])
    : new Set();
  if (parsed.data.connector.type === 'rest-apikey') {
    for (const endpoint of parsed.data.connector.endpoints) {
      if (endpointIds.has(endpoint.id)) errors.push(`重复的 endpoint id: ${endpoint.id}`);
      endpointIds.add(endpoint.id);
    }
  }
  for (const page of parsed.data.pages) {
    for (const widget of page.widgets) {
      if ('endpoint' in widget && !endpointIds.has(widget.endpoint)) {
        errors.push(`页面 ${page.id} 的 widget 引用了不存在的 endpoint: ${widget.endpoint}`);
      }
    }
  }
  return { ok: errors.length === 0, errors, data: parsed.data };
}

export function parseSpec(spec) {
  const result = validateSpec(spec);
  if (!result.ok) throw new AppError(ErrorCode.INVALID_SPEC, 'Spec 校验失败', result.errors);
  return result.data;
}

export function usedEndpoints(spec) {
  const set = new Set();
  for (const page of spec.pages || []) {
    for (const widget of page.widgets || []) if (widget.endpoint) set.add(widget.endpoint);
  }
  return [...set];
}
