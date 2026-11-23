// FILE: src/app/investments/investments.ts  (NEW file)
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AgChartOptions } from 'ag-charts-community';
import { ToastrService } from 'ngx-toastr';
import { chartTheme, toneColor } from '../shared/chart-theme';
import { formatUsd, formatUsdExact } from '../shared/design-tokens';
import { BalanceDialog, BalanceDialogData } from './balance-dialog';
import {
  Holdings,
  InvestmentCard,
  InvestmentIncome,
  InvestmentService,
  InvestmentSummary,
} from './investment-service';

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: 'Brokerage and crypto', kinds: ['brokerage', 'crypto'] },
  { title: 'Cash: HYSA and savings', kinds: ['cash'] },
  { title: 'Retirement and HSA', kinds: ['retirement', 'hsa'] },
  { title: 'Property and gold', kinds: ['property', 'metal', 'other'] },
];
const ALLOCATION_COLORS: Record<string, string> = {
  stocks: '#2f6fd0',
  retirement: '#0f5c4d',
  cash: '#c98312',
  crypto: '#7a5cc2',
  hsa: '#3b8fa8',
  property: '#d2493f',
  other: '#8a7e63',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Component({
  selector: 'app-investments',
  standalone: false,
  templateUrl: './investments.html',
  styleUrl: './investments.css',
})
export class Investments implements OnInit, OnDestroy {
  summary: InvestmentSummary | null = null;
  state: 'loading' | 'ready' | 'unavailable' = 'loading';
  groups: { title: string; cards: InvestmentCard[] }[] = [];
  holdingsAccounts: InvestmentCard[] = [];

  selectedHoldings: number | null = null;
  holdings: Holdings | null = null;
  holdingsState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';

  years: number[] = [];
  incomeYear = new Date().getFullYear();
  /** '' = both people; 'SCP' or 'SJ' = one person's accounts only. */
  incomeOwner: '' | 'SCP' | 'SJ' = '';
  readonly owners: { value: '' | 'SCP' | 'SJ'; label: string }[] = [
    { value: '', label: 'Both' },
    { value: 'SCP', label: 'SCP' },
    { value: 'SJ', label: 'SJ' },
  ];
  income: InvestmentIncome | null = null;
  incomeChart!: AgChartOptions;

  refreshing = false;
  usd = formatUsd;
  usdExact = formatUsdExact;
  allocationColors = ALLOCATION_COLORS;

  private dark = false;
  private themeObserver?: MutationObserver;

  constructor(
    private invest: InvestmentService,
    private toastr: ToastrService,
    private dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    const year = new Date().getFullYear();
    for (let y = year; y >= year - 5; y--) this.years.push(y);
    this.dark = document.documentElement.getAttribute('data-theme') === 'dark';
    this.themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (dark !== this.dark) {
        this.dark = dark;
        this.buildIncomeChart();
      }
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.load();
    this.loadIncome();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }

  // ---------- Loading ----------

  load(): void {
    this.invest.summary().subscribe({
      next: (data) => {
        this.summary = data;
        this.state = 'ready';
        this.groups = GROUPS.map((g) => ({
          title: g.title,
          cards: data.accounts.filter((a) => g.kinds.includes(a.kind) && this.showCard(a)),
        })).filter((g) => g.cards.length);
        this.holdingsAccounts = data.accounts.filter((a) => a.tracks_holdings);
        const keep = this.holdingsAccounts.find((a) => a.category_id === this.selectedHoldings);
        const first = keep ?? this.holdingsAccounts.find((a) => a.status === 'ok') ?? this.holdingsAccounts[0];
        if (first) this.selectHoldings(first.category_id);
      },
      error: () => {
        this.state = 'unavailable';
        this.toastr.error('Could not load investments. Check that the API is running and up to date.');
      },
    });
  }

  /** Accounts with no data at all (e.g. an unused savings account) stay hidden. */
  private showCard(a: InvestmentCard): boolean {
    if (a.kind === 'property' || a.tracks_holdings) return true;
    return !(a.estimated && !a.value && !a.put_in_records && !a.income_total);
  }

  selectHoldings(categoryId: number): void {
    this.selectedHoldings = categoryId;
    this.holdingsState = 'loading';
    this.invest.holdings(categoryId).subscribe({
      next: (h) => {
        this.holdings = h;
        this.holdingsState = 'ready';
      },
      error: () => {
        this.holdings = null;
        this.holdingsState = 'unavailable';
      },
    });
  }

  loadIncome(): void {
    this.invest.income(this.incomeYear, this.incomeOwner).subscribe({
      next: (data) => {
        this.income = data;
        this.buildIncomeChart();
      },
      error: () => (this.income = null),
    });
  }

  setIncomeOwner(owner: '' | 'SCP' | 'SJ'): void {
    if (owner === this.incomeOwner) return;
    this.incomeOwner = owner;
    this.loadIncome();
  }

  onYearChange(year: number): void {
    this.incomeYear = year;
    this.loadIncome();
  }

  // ---------- Actions ----------

  refreshPrices(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.invest.refreshPrices(false).subscribe({
      next: (r) => {
        this.refreshing = false;
        if (r.failed.length) {
          this.toastr.warning(
            r.failed.map((f) => `${f.symbol}: ${f.reason}`).join(' '),
            `Updated ${r.updated.length}; ${r.failed.length} could not be updated`,
          );
        } else if (r.updated.length) {
          this.toastr.success(`Updated ${r.updated.length} prices.`);
        } else {
          this.toastr.info('Prices were updated a few minutes ago.');
        }
        this.load();
      },
      error: (err) => {
        this.refreshing = false;
        this.toastr.error(err?.error?.error ?? 'Could not refresh prices.');
      },
    });
  }

  updateBalance(card: InvestmentCard): void {
    const data: BalanceDialogData = {
      categoryId: card.category_id,
      name: card.name,
      kind: card.kind,
      current: card.kind === 'property' ? card.home_value ?? null : card.tracks_holdings ? card.cash ?? 0 : card.value,
    };
    this.dialog
      .open(BalanceDialog, { width: '480px', maxWidth: '94vw', autoFocus: 'dialog', data })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) this.load();
      });
  }

  deleteTrade(id: number, label: string): void {
    if (!confirm(`Delete this trade (${label})? A buy with new money also removes its Saving transaction.`)) return;
    this.invest.deleteTrade(id).subscribe({
      next: () => {
        this.toastr.success('Trade deleted.');
        this.load();
        this.loadIncome();
      },
      error: (err) => this.toastr.error(err?.error?.error ?? 'Could not delete the trade.'),
    });
  }

  // ---------- Display helpers ----------

  signed(n: number | null | undefined): string {
    if (n == null) return '—';
    return (n >= 0 ? '+' : '−') + formatUsd(Math.abs(n));
  }

  signedExact(n: number | null | undefined): string {
    if (n == null) return '—';
    return (n >= 0 ? '+' : '−') + formatUsdExact(Math.abs(n));
  }

  pct(n: number | null | undefined): string {
    if (n == null) return '';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  gainClass(n: number | null | undefined): string {
    if (n == null || Math.abs(n) < 0.005) return '';
    return n > 0 ? 'pos' : 'neg';
  }

  qty(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }

  price(n: number | null): string {
    if (n == null) return '—';
    return n < 1 ? '$' + n.toFixed(4) : formatUsdExact(n);
  }

  dayText(iso: string | null | undefined): string {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  fetchedText(iso: string | null | undefined): string {
    if (!iso) return 'not fetched yet';
    const d = new Date(iso);
    const today = new Date();
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? `today, ${time}` : `${this.dayText(iso)}, ${time}`;
  }

  canUpdateBalance(card: InvestmentCard): boolean {
    return !card.tracks_holdings || card.status === 'ok';
  }

  updateLabel(card: InvestmentCard): string {
    if (card.kind === 'property') return card.status === 'value_needed' ? 'Set value' : 'Update value';
    if (card.tracks_holdings) return 'Set cash';
    return card.estimated ? 'Set balance' : 'Update balance';
  }

  fundingText(f: string | null): string {
    return f === 'new_money' ? 'New money' : f === 'transfer' ? 'Moved in' : f === 'account_cash' ? 'Account cash' : '';
  }

  // ---------- Chart ----------

  private buildIncomeChart(): void {
    if (!this.income) return;
    const data = this.income.months.map((m) => ({ label: m.label, dividends: m.dividends, interest: m.interest }));
    const divColor = toneColor('income', this.dark);
    const intColor = toneColor('debt', this.dark);
    this.incomeChart = {
      theme: chartTheme(this.dark),
      background: { visible: false },
      data,
      series: [
        {
          type: 'bar', xKey: 'label', yKey: 'dividends', yName: 'Dividends', stacked: true,
          fill: divColor, stroke: divColor,
          tooltip: { renderer: (p: any) => ({ title: p.datum.label, content: `Dividends ${formatUsdExact(p.datum.dividends)}` }) },
        },
        {
          type: 'bar', xKey: 'label', yKey: 'interest', yName: 'Interest', stacked: true,
          fill: intColor, stroke: intColor,
          tooltip: { renderer: (p: any) => ({ title: p.datum.label, content: `Interest ${formatUsdExact(p.datum.interest)}` }) },
        },
      ],
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left', label: { formatter: (p: any) => formatUsd(p.value) } },
      ],
      legend: { position: 'bottom' },
    } as AgChartOptions;
  }
}
