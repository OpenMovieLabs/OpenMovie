import { describe, expect, it } from 'vitest';

import { detectUiLocale, translate } from './i18n.js';

describe('desktop i18n', () => {
  it('detects Chinese locales and interpolates accessible status text', () => {
    expect(detectUiLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(detectUiLocale('en-US')).toBe('en');
    expect(translate('zh-CN', 'coreUnavailable', { message: '连接失败' })).toBe(
      'Core 不可用：连接失败',
    );
  });
});
