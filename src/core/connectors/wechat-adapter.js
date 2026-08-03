import { ConnectorAdapter } from './adapter.js';
import { AppError, ErrorCode } from '../errors.js';
import { meta } from './wechat-mp.js';

export class WechatMpAdapter extends ConnectorAdapter {
  constructor() {
    super({ ...meta, supportsActions: false });
  }

  buildActionRequest() {
    throw new AppError(ErrorCode.INVALID_STATE, '微信公众号连接器暂不支持写操作');
  }
}
