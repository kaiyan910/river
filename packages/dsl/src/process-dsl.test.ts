import { describe, expect, it } from 'vitest';
import { processDslSchema } from './index.js';

describe('Process DSL', () => {
  it('沒有節點與連線的流程圖可以通過 schema 解析', () => {
    expect(processDslSchema.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });
});
