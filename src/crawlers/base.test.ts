import { describe, it, expect } from 'vitest';
import { parsePrice, pricePerKToPerM, pricePerTokenToPerM } from './base.js';

describe('Base Crawler Utils', () => {
  describe('parsePrice', () => {
    it('should parse price with dollar sign', () => {
      expect(parsePrice('$10.00')).toBe(10);
      expect(parsePrice('$0.50')).toBe(0.5);
      expect(parsePrice('$0.0001')).toBeCloseTo(0.0001);
    });

    it('should parse price without dollar sign', () => {
      expect(parsePrice('10.00')).toBe(10);
      expect(parsePrice('0.50')).toBe(0.5);
    });

    it('should handle prices with extra characters', () => {
      expect(parsePrice('$1.00 / 1K tokens')).toBe(1);
      expect(parsePrice('USD 5.00')).toBe(5);
    });

    it('should handle negative prices', () => {
      expect(parsePrice('-10.00')).toBe(-10);
    });
  });

  describe('pricePerKToPerM', () => {
    it('should convert per 1K to per 1M', () => {
      expect(pricePerKToPerM(0.01)).toBe(10);
      expect(pricePerKToPerM(0.03)).toBe(30);
      expect(pricePerKToPerM(0.0015)).toBeCloseTo(1.5);
    });
  });

  describe('pricePerTokenToPerM', () => {
    it('should convert per token to per 1M', () => {
      expect(pricePerTokenToPerM(0.00001)).toBe(10);
      expect(pricePerTokenToPerM(0.000001)).toBe(1);
      expect(pricePerTokenToPerM(0.0000001)).toBeCloseTo(0.1);
    });
  });
});
