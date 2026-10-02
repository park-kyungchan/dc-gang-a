import { expect, it } from 'bun:test';
import { decodePaperCode, encodePaperCode } from '../../src/lms/printedPaperCode';

it('decodes the reviewed custom alphabet instead of standard base32 or base36', () => {
  expect(decodePaperCode('#3')).toBe('1');
  expect(decodePaperCode('#A')).toBe('8');
  expect(decodePaperCode('#Z')).toBe('31');
  expect(decodePaperCode('#32')).toBe('32');
});

it('encodes positive canonical source keys with the same printed prefix', () => {
  expect(encodePaperCode('1')).toBe('#3');
  expect(encodePaperCode('8')).toBe('#A');
  expect(encodePaperCode('31')).toBe('#Z');
  expect(encodePaperCode('32')).toBe('#32');
});

it('round trips synthetic boundary values without precision loss', () => {
  for (const key of ['1', '31', '32', '1024', '8101', String(Number.MAX_SAFE_INTEGER)]) {
    expect(decodePaperCode(encodePaperCode(key))).toBe(key);
  }
});

it('rejects invalid or noncanonical tokens before any identity lookup', () => {
  for (const code of ['3', '#', '#2', '#23', '#O', '#I', '#0', '#1', '#a', ' #3', '#3 ', '#ZZZZZZZZZZZ']) {
    expect(() => decodePaperCode(code)).toThrow();
  }
  for (const key of ['0', '01', ' 1', '1 ', '1e3', '-1', '9007199254740992']) {
    expect(() => encodePaperCode(key)).toThrow();
  }
});
