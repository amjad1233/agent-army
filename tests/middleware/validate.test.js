import { describe, it, expect } from 'vitest';
import { parseId, validateMessage, validateLocalPath } from '../../server/middleware/validate.js';

describe('parseId', () => {
  it('parses a valid positive integer string', () => {
    expect(parseId('42')).toBe(42);
  });

  it('throws 400 for zero', () => {
    expect(() => parseId('0')).toThrow();
    expect(() => parseId('0')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 for negative numbers', () => {
    expect(() => parseId('-1')).toThrow();
  });

  it('throws 400 for non-numeric strings', () => {
    expect(() => parseId('abc')).toThrow();
  });
});

describe('validateMessage', () => {
  it('returns trimmed message', () => {
    expect(validateMessage('  hello  ')).toBe('hello');
  });

  it('throws 400 for empty string', () => {
    expect(() => validateMessage('')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 413 for message over 10KB', () => {
    const big = 'x'.repeat(10 * 1024 + 1);
    expect(() => validateMessage(big)).toThrowError(expect.objectContaining({ status: 413 }));
  });
});

describe('validateLocalPath', () => {
  it('returns trimmed path', () => {
    expect(validateLocalPath('/Users/foo/bar')).toBe('/Users/foo/bar');
  });

  it('throws 400 for path traversal', () => {
    expect(() => validateLocalPath('/foo/../../../etc/passwd')).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 for empty', () => {
    expect(() => validateLocalPath('')).toThrowError(expect.objectContaining({ status: 400 }));
  });
});
