// FILE: src/app/shared/chart-theme.ts  (NEW file)
import type { AgChartOptions, AgChartTheme } from 'ag-charts-community';
import { CATEGORICAL_RAMP, TONES, UI, formatUsd, type MoneyKind } from './design-tokens';

/**
 * Chart options for the Dashboard.
 *
 * Charts draw on a canvas, so they cannot read CSS variables. Instead we
 * rebuild the options when the theme changes (Home listens for the
 * `data-theme` attribute) and pass `dark` into every builder here.
 * The chart background is transparent, so the card behind it supplies
 * the surface color in both themes.
 */

const DARK_TONES: Record<MoneyKind, string> = {
  income: '#3fc58a',
  expense: '#f0766c',
  savings: '#6a9df0',
  debt: '#e6a73d',
};

const DARK_RAMP: string[] = [
  '#3fb59b',
  '#6a9df0',
  '#e6a73d',
  '#f0766c',
  '#a78bdc',
  '#3fc58a',
  '#f0955f',
  '#62b4cc',
  '#d27aa5',
  '#9bbf4a',
  '#9bada7',
];

export const toneColor = (kind: MoneyKind, dark: boolean): string =>
  dark ? DARK_TONES[kind] : TONES[kind].main;

/** Shared AG Charts theme: font, palette, and light/dark base. */
export function chartTheme(dark: boolean): AgChartTheme {
  const ramp = dark ? DARK_RAMP : CATEGORICAL_RAMP;
  return {
    baseTheme: dark ? 'ag-default-dark' : 'ag-default',
    palette: { fills: ramp, strokes: ramp },
    params: { fontFamily: UI.fontFamily },
  } as AgChartTheme;
}

/* ---------- Monthly line chart ---------- */

export interface SummaryRow {
  month: string;
  income: number;
  expense: number;
  debt: number;
  savings: number;
}

const LINES: { key: keyof SummaryRow; name: string; kind: MoneyKind }[] = [
  { key: 'income', name: 'Income', kind: 'income' },
  { key: 'expense', name: 'Expenses', kind: 'expense' },
  { key: 'savings', name: 'Savings', kind: 'savings' },
  { key: 'debt', name: 'Debt', kind: 'debt' },
];

export function lineChartOptions(data: SummaryRow[], dark: boolean): AgChartOptions {
  return {
    theme: chartTheme(dark),
    background: { visible: false },
    data,
    series: LINES.map((line) => {
      const color = toneColor(line.kind, dark);
      return {
        type: 'line' as const,
        xKey: 'month',
        yKey: line.key,
        yName: line.name,
        stroke: color,
        strokeWidth: 2.5,
        marker: { size: 6, fill: color, stroke: color },
        tooltip: {
          renderer: (params: any) => ({
            title: `${line.name} · ${params.datum.month}`,
            content: formatUsd(params.datum[line.key]),
          }),
        },
      };
    }),
    axes: [
      { type: 'category', position: 'bottom' },
      {
        type: 'number',
        position: 'left',
        label: { formatter: (params: any) => formatUsd(params.value) },
      },
    ],
    legend: { position: 'bottom' },
  } as AgChartOptions;
}

/* ---------- Category donut ---------- */

export interface CategoryRow {
  category: string;
  amount: number;
}

/** Drops $0 slices, tidies names, and sorts biggest first. */
export function prepareDonutData(rows: CategoryRow[] | undefined): CategoryRow[] {
  return (rows ?? [])
    .filter((r) => Number(r.amount) > 0)
    .map((r) => ({ category: String(r.category).trim(), amount: Number(r.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

export function donutChartOptions(
  data: CategoryRow[],
  kind: MoneyKind,
  dark: boolean,
): AgChartOptions {
  const total = data.reduce((sum, r) => sum + r.amount, 0);
  const label = kind === 'expense' ? 'Expenses' : kind === 'income' ? 'Income' : 'Savings';

  return {
    theme: chartTheme(dark),
    background: { visible: false },
    data,
    series: [
      {
        type: 'donut' as const,
        angleKey: 'amount',
        legendItemKey: 'category',
        innerRadiusRatio: 0.64,
        sectorSpacing: 2,
        calloutLabel: { enabled: false },
        sectorLabel: { enabled: false },
        innerLabels: [
          { text: formatUsd(total), fontSize: 22, fontWeight: 'bold' },
          { text: `Total ${label.toLowerCase()}`, fontSize: 12, margin: 4 },
        ],
        tooltip: {
          renderer: (params: any) => ({
            title: params.datum.category,
            content: `${formatUsd(params.datum.amount)} (${Math.round(
              (params.datum.amount / (total || 1)) * 100,
            )}%)`,
          }),
        },
      },
    ],
    legend: { position: 'bottom' },
  } as AgChartOptions;
}
