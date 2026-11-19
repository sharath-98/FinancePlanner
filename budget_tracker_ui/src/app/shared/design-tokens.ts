/**
 * Design tokens for places that cannot read CSS variables directly
 * (AG Grid theme params, AG Charts options).
 * Keep these values in sync with src/styles.scss.
 */

export type MoneyKind = 'income' | 'expense' | 'savings' | 'debt';

export interface TonePalette {
  main: string;
  soft: string;
}

export const TONES: Record<MoneyKind, TonePalette> = {
  income: { main: '#1e8e5a', soft: '#e3f4ec' },
  expense: { main: '#d2493f', soft: '#fbe9e7' },
  savings: { main: '#2f6fd0', soft: '#e6eefb' },
  debt: { main: '#c98312', soft: '#fbf1dd' },
};

export const UI = {
  brand: '#0f5c4d',
  surface: '#ffffff',
  surface2: '#f8faf7',
  border: '#dfe4de',
  text: '#15211e',
  textMuted: '#5b6b66',
  fontFamily: 'Manrope, system-ui, sans-serif',
} as const;

/** Colors for donut slices when a chart has many categories. */
export const CATEGORICAL_RAMP: string[] = [
  '#0f5c4d',
  '#2f6fd0',
  '#c98312',
  '#d2493f',
  '#7a5cc2',
  '#1e8e5a',
  '#e07a3f',
  '#3b8fa8',
  '#a64d79',
  '#6b8e23',
  '#8a9892',
];

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const usdExact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

export const formatUsd = (value: number | null | undefined): string => usd.format(value ?? 0);
export const formatUsdExact = (value: number | null | undefined): string =>
  usdExact.format(value ?? 0);
