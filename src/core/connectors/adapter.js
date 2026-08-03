import { AppError, ErrorCode } from '../errors.js';

export class ConnectorAdapter {
  constructor(meta) {
    this.meta = Object.freeze(meta);
  }

  describe() {
    return this.meta;
  }

  buildReadRequest() {
    throw new AppError(ErrorCode.INVALID_STATE, '连接器未实现读取请求');
  }

  buildActionRequest() {
    throw new AppError(ErrorCode.INVALID_STATE, '连接器未实现写操作');
  }
}

export class ConnectorRegistry {
  #adapters = new Map();

  register(adapter) {
    const id = adapter?.meta?.id;
    if (!id) throw new AppError(ErrorCode.INVALID_INPUT, '连接器缺少 id');
    if (this.#adapters.has(id)) throw new AppError(ErrorCode.CONFLICT, `重复连接器: ${id}`);
    this.#adapters.set(id, adapter);
    return this;
  }

  get(id) {
    const adapter = this.#adapters.get(id);
    if (!adapter) throw new AppError(ErrorCode.NOT_FOUND, `未知连接器: ${id}`);
    return adapter;
  }

  list() {
    return [...this.#adapters.values()].map((adapter) => adapter.describe());
  }
}
