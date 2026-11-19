// FILE: src/app/home/home.ts  (REPLACE existing file)
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { AgChartOptions } from 'ag-charts-community';
import { ToastrService } from 'ngx-toastr';
import { HomeService } from './home-service';
import {
  CategoryRow,
  SummaryRow,
  donutChartOptions,
  lineChartOptions,
  prepareDonutData,
} from '../shared/chart-theme';
import { formatUsd } from '../shared/design-tokens';

interface Kpi {
  key: string;
  label: string;
  value: number;
  note: string;
  /** Class from styles.scss that sets the card's accent color */
  tone: 'tone-income' | 'tone-expense' | 'tone-savings' | 'tone-debt' | 'tone-neutral';
}

interface YearOverYearRow {
  current: number;
  previous: number;
  change_pct: number | null;
}

interface Insights {
  range: { start: string; end: string; months: number; last_month: string };
  savings_rate: {
    current: number | null;
    previous: number | null;
    income: number;
    savings: number;
    monthly: { month: string; rate: number | null }[];
  };
  year_over_year: {
    previous_start: string;
    previous_end: string;
    income: YearOverYearRow;
    expense: YearOverYearRow;
    savings: YearOverYearRow;
    debt: YearOverYearRow;
  };
  unusual_spending: {
    month: string;
    alerts: {
      category: string;
      amount: number;
      usual: number;
      extra: number;
      times_usual: number;
      months_compared: number;
    }[];
  };
  large_transactions: {
    id: number;
    date: string;
    merchant: string;
    category: string;
    amount: number;
    typical: number;
  }[];
}

interface MomPair {
  current: number;
  previous: number;
  change: number;
  change_pct: number | null;
}

interface MomMover {
  category: string;
  current: number;
  previous: number;
  change: number;
  change_pct: number | null;
}

interface MonthOverMonth {
  month: string;
  previous_month: string;
  in_progress: boolean;
  shifted_to_last_complete: boolean;
  totals: { income: MomPair; expense: MomPair; savings: MomPair; debt: MomPair };
  savings_rate: { current: number | null; previous: number | null };
  movers: { increases: MomMover[]; decreases: MomMover[] };
  trend: SummaryRow[];
}

type ChangeTone = 'good' | 'bad' | 'flat';

@Component({
  selector: 'app-home',
  standalone: false,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit, OnDestroy {
  today = new Date();
  startOfYear = new Date(this.today.getFullYear(), 0, 1);

  range = new FormGroup({
    start: new FormControl<Date | null>(this.startOfYear),
    end: new FormControl<Date | null>(new Date()),
  });

  /* Raw data from the API (kept so charts can be rebuilt when the theme changes) */
  summaryData: SummaryRow[] = [];
  incomeData: CategoryRow[] = [];
  savingsData: CategoryRow[] = [];
  expenseData: CategoryRow[] = [];

  kpis: Kpi[] = [];
  usd = formatUsd;

  /** Insight cards (savings rate, year over year, unusual spending, large purchases). */
  insights: Insights | null = null;
  insightsState: 'loading' | 'ready' | 'unavailable' = 'loading';
  /** Month over month: the last month of the range against the month before it. */
  mom: MonthOverMonth | null = null;
  momState: 'loading' | 'ready' | 'unavailable' = 'loading';
  /** When on, a month that is still in progress is replaced by the last finished month. */
  momCompleteOnly = false;
  readonly momTiles: { key: 'income' | 'expense' | 'savings' | 'debt'; label: string }[] = [
    { key: 'income', label: 'Income' },
    { key: 'expense', label: 'Expenses' },
    { key: 'savings', label: 'Savings' },
    { key: 'debt', label: 'Debt' },
  ];
  readonly yoyRows: { key: 'income' | 'expense' | 'savings' | 'debt'; label: string }[] = [
    { key: 'income', label: 'Income' },
    { key: 'expense', label: 'Expenses' },
    { key: 'savings', label: 'Savings' },
    { key: 'debt', label: 'Debt' },
  ];

  public summaryChartOptions!: AgChartOptions;
  public incomeChartOptions!: AgChartOptions;
  public savingsChartOptions!: AgChartOptions;
  public expenseChartOptions!: AgChartOptions;
  public momChartOptions!: AgChartOptions;

  private dark = false;
  private themeObserver?: MutationObserver;

  constructor(
    private homeSrv: HomeService,
    private toastr: ToastrService,
  ) {
    this.rebuildCharts();
    this.buildKpis();
  }

  ngOnInit(): void {
    this.dark = this.isDarkTheme();
    this.rebuildCharts();

    // The theme toggle in the header sets data-theme on <html>; redraw charts when it changes.
    this.themeObserver = new MutationObserver(() => {
      const dark = this.isDarkTheme();
      if (dark !== this.dark) {
        this.dark = dark;
        this.rebuildCharts();
      }
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    this.onDatePickerClosed();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }

  onDatePickerClosed() {
    const { start, end } = this.range.value;
    // The picker fires "closed" after the first click too; wait for a full range.
    if (!start || !end) return;

    const payload = {
      start: start.toISOString(),
      end: end.toISOString(),
    };

    // Two requests can fail together; show one message, not two
    let failed = false;
    const onError = () => {
      if (failed) return;
      failed = true;
      this.toastr.error(
        'Could not load the dashboard. Check that the API is running and try again.',
      );
    };

    this.homeSrv.get_summary_chart(payload).subscribe({
      next: (data) => {
        this.summaryData = Array.isArray(data) ? data : [];
        this.buildKpis();
        this.rebuildCharts();
      },
      error: onError,
    });

    this.loadMonthOverMonth();

    // The insights are extras: if they cannot load, the rest of the dashboard still works.
    this.insightsState = 'loading';
    this.homeSrv.get_insights(payload).subscribe({
      next: (data) => {
        this.insights = data ?? null;
        this.insightsState = this.insights ? 'ready' : 'unavailable';
      },
      error: () => {
        this.insights = null;
        this.insightsState = 'unavailable';
      },
    });

    this.homeSrv.get_sub_chart(payload).subscribe({
      next: (data) => {
        this.incomeData = prepareDonutData(data?.['income']);
        this.savingsData = prepareDonutData(data?.['savings']);
        this.expenseData = prepareDonutData(data?.['expense']);
        this.rebuildCharts();
      },
      error: onError,
    });
  }

  /** Totals for the selected range, from the same monthly data the trend chart uses. */
  private buildKpis(): void {
    const sum = (key: keyof SummaryRow) =>
      this.summaryData.reduce((total, row) => total + (Number(row[key]) || 0), 0);

    const income = sum('income');
    const expense = sum('expense');
    const savings = sum('savings');
    const debt = sum('debt');
    const unallocated = income - expense - savings - debt;

    const share = (value: number) =>
      income > 0 ? `${Math.round((value / income) * 100)}% of income` : 'No income tracked';
    const months = this.summaryData.length;

    this.kpis = [
      {
        key: 'income',
        label: 'Income',
        value: income,
        tone: 'tone-income',
        note: `Across ${months} ${months === 1 ? 'month' : 'months'}`,
      },
      {
        key: 'expense',
        label: 'Expenses',
        value: expense,
        tone: 'tone-expense',
        note: share(expense),
      },
      {
        key: 'savings',
        label: 'Savings',
        value: savings,
        tone: 'tone-savings',
        note: share(savings),
      },
      { key: 'debt', label: 'Debt', value: debt, tone: 'tone-debt', note: share(debt) },
      {
        key: 'unallocated',
        label: 'Unallocated',
        value: unallocated,
        tone: unallocated < 0 ? 'tone-expense' : 'tone-neutral',
        note: unallocated < 0 ? 'Spending exceeds income' : 'Income not yet assigned',
      },
    ];
  }

  // ---------- Month over month ----------

  /** Uses the last month of the picked range; failures only hide this section. */
  private loadMonthOverMonth(): void {
    const end = this.range.value.end;
    if (!end) return;
    this.momState = 'loading';
    this.homeSrv
      .get_month_over_month({ end: end.toISOString(), complete_only: this.momCompleteOnly })
      .subscribe({
        next: (data) => {
          this.mom = data ?? null;
          this.momState = this.mom ? 'ready' : 'unavailable';
          this.rebuildCharts();
        },
        error: () => {
          this.mom = null;
          this.momState = 'unavailable';
        },
      });
  }

  onCompleteOnlyChange(checked: boolean): void {
    this.momCompleteOnly = checked;
    this.loadMonthOverMonth();
  }

  /** "+$150" / "−$60" / "$0". */
  signedUsd(value: number): string {
    if (value === 0) return this.usd(0);
    return `${value > 0 ? '+' : '−'}${this.usd(Math.abs(value))}`;
  }

  /** "+12%" or, when last month was zero, "new". */
  momPct(row: { previous: number; change_pct: number | null }): string {
    if (row.change_pct == null) return row.previous === 0 ? 'new' : 'n/a';
    return `${row.change_pct > 0 ? '+' : ''}${row.change_pct}%`;
  }

  momRateChange(mom: MonthOverMonth): string {
    const { current, previous } = mom.savings_rate;
    if (current == null || previous == null) return 'No earlier month to compare';
    const points = Math.round((current - previous) * 1000) / 10;
    if (points === 0) return `Same as ${mom.previous_month}`;
    const size = Math.abs(points);
    return `${points > 0 ? 'Up' : 'Down'} ${size} ${size === 1 ? 'point' : 'points'} from ${this.rateText(previous)}`;
  }

  // ---------- Insight card helpers ----------

  rateText(rate: number | null | undefined): string {
    return rate == null ? '—' : `${Math.round(rate * 1000) / 10}%`;
  }

  /** "up 2.5 points" / "down 1 point" compared with the period before. */
  rateChange(ins: Insights): string {
    const { current, previous } = ins.savings_rate;
    if (current == null || previous == null) return 'No earlier period to compare';
    const points = Math.round((current - previous) * 1000) / 10;
    if (points === 0) return `Same as the ${ins.range.months} months before`;
    const size = Math.abs(points);
    return `${points > 0 ? 'Up' : 'Down'} ${size} ${size === 1 ? 'point' : 'points'} from the ${ins.range.months} months before (${this.rateText(previous)})`;
  }

  /** Bars for the monthly savings rate; the tallest month fills the height. */
  rateBars(ins: Insights): { label: string; height: number }[] {
    const rates = ins.savings_rate.monthly.map((m) => Math.max(0, m.rate ?? 0));
    const top = Math.max(...rates, 0.0001);
    return ins.savings_rate.monthly.map((m, i) => ({
      label: `${m.month}: ${this.rateText(m.rate)}`,
      height: Math.max(4, (rates[i] / top) * 100),
    }));
  }

  changeText(change: number | null): string {
    if (change == null) return 'n/a';
    return `${change > 0 ? '+' : ''}${change}%`;
  }

  /** More income or savings is good, more spending is not. Debt payments are shown neutral. */
  changeTone(kind: string, change: number | null): ChangeTone {
    if (change == null || change === 0 || kind === 'debt') return 'flat';
    const up = change > 0;
    return (kind === 'expense' ? !up : up) ? 'good' : 'bad';
  }

  yoyNote(ins: Insights): string {
    const label = (iso: string) => {
      const [y, m] = iso.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
    };
    return `Compared with ${label(ins.year_over_year.previous_start)} to ${label(ins.year_over_year.previous_end)}.`;
  }

  dayText(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleString('en-US', { month: 'short', day: 'numeric' });
  }

  private rebuildCharts(): void {
    this.summaryChartOptions = lineChartOptions(this.summaryData, this.dark);
    this.incomeChartOptions = donutChartOptions(this.incomeData, 'income', this.dark);
    this.savingsChartOptions = donutChartOptions(this.savingsData, 'savings', this.dark);
    this.expenseChartOptions = donutChartOptions(this.expenseData, 'expense', this.dark);
    this.momChartOptions = lineChartOptions(this.mom?.trend ?? [], this.dark);
  }

  private isDarkTheme(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
}
