import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, parseHex } from './colorMath';

describe('colorMath', () => {
  it('parses 3 and 6 digit hex', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc');
    expect(parseHex('ff8800')).toBe('#ff8800');
    expect(parseHex('nope')).toBeNull();
  });

  it('round-trips saturated colors through hsv', () => {
    expect(hsvToHex(hexToHsv('#ff0000'))).toBe('#ff0000');
    expect(hsvToHex(hexToHsv('#00ff00'))).toBe('#00ff00');
    expect(hsvToHex(hexToHsv('#0000ff'))).toBe('#0000ff');
    expect(hsvToHex(hexToHsv('#ffffff'))).toBe('#ffffff');
    expect(hsvToHex(hexToHsv('#000000'))).toBe('#000000');
  });
});
