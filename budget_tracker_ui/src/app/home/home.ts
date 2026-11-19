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

  public summaryChartOptions!: AgChartOptions;
  public incomeChartOptions!: AgChartOptions;
  public savingsChartOptions!: AgChartOptions;
  public expenseChartOptions!: AgChartOptions;

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

  private rebuildCharts(): void {
    this.summaryChartOptions = lineChartOptions(this.summaryData, this.dark);
    this.incomeChartOptions = donutChartOptions(this.incomeData, 'income', this.dark);
    this.savingsChartOptions = donutChartOptions(this.savingsData, 'savings', this.dark);
    this.expenseChartOptions = donutChartOptions(this.expenseData, 'expense', this.dark);
  }

  private isDarkTheme(): boolean {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
}
