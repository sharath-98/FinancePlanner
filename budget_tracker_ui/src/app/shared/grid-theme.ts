// FILE: src/app/shared/grid-theme.ts  (NEW file)
import {
  themeQuartz,
  type CellClassParams,
  type Theme,
  type ValueFormatterParams,
} from 'ag-grid-community';
import type { MoneyKind } from './design-tokens';

/**
 * One AG Grid theme, tinted per money category.
 *
 * Params use CSS variables from src/styles.scss, so light/dark mode
 * switches automatically with no extra grid code.
 * Use in a template with:  <ag-grid-angular [theme]="incomeTheme" ... />
 * (and do NOT add an `ag-theme-*` class to the same element).
 */
export type GridKind = MoneyKind | 'neutral';

const TONES: Record<GridKind, { main: string; soft: string }> = {
  income: { main: 'var(--income)', soft: 'var(--income-soft)' },
  expense: { main: 'var(--expense)', soft: 'var(--expense-soft)' },
  savings: { main: 'var(--savings)', soft: 'var(--savings-soft)' },
  debt: { main: 'var(--debt)', soft: 'var(--debt-soft)' },
  neutral: { main: 'var(--brand)', soft: 'var(--brand-soft)' },
};

const cache = new Map<GridKind, Theme>();

export function gridTheme(kind: GridKind = 'neutral'): Theme {
  const cached = cache.get(kind);
  if (cached) return cached;

  const tone = TONES[kind];
  const theme = themeQuartz.withParams({
    fontFamily: 'Manrope, system-ui, sans-serif',
    fontSize: 14,
    spacing: 7,

    backgroundColor: 'var(--surface)',
    foregroundColor: 'var(--text)',
    borderColor: 'var(--border)',
    rowHoverColor: 'var(--surface-2)',
    selectedRowBackgroundColor: tone.soft,
    accentColor: tone.main,

    headerBackgroundColor: tone.soft,
    // The tone color pulled toward the text color, so headers stay readable on the soft background
    headerTextColor: `color-mix(in srgb, ${tone.main} 60%, var(--text))`,
    headerFontWeight: 700,
    headerFontSize: 13,
    headerHeight: 44,

    borderRadius: 8,
    wrapperBorderRadius: 12,
    inputBorder: { color: 'var(--border-strong)' },
    cellEditingBorder: { color: tone.main },
  });

  cache.set(kind, theme);
  return theme;
}

/* ---------- Shared cell helpers ---------- */

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Formats a cell as USD. Accepts numbers or numeric strings (e.g. "12.50"). */
export const moneyFormatter = (params: ValueFormatterParams): string => {
  const raw = params.value;
  if (raw === null || raw === undefined || raw === '') return '';
  const n = Number(raw);
  return Number.isNaN(n) ? String(raw) : money.format(n);
};

/** Mutes $0 cells so real values stand out. Styled by `.zero-cell` in styles.scss. */
export const moneyCellClass = (params: CellClassParams): string =>
  Number(params.value) === 0 ? 'zero-cell' : '';
