// FILE: src/app/investments/investments.ts  (NEW file)
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AgChartOptions } from 'ag-charts-community';
import { ToastrService } from 'ngx-toastr';
import { chartTheme, toneColor } from '../shared/chart-theme';
import { formatUsd, formatUsdExact } from '../shared/design-tokens';
import { AccountDialog, AccountDialogData } from './account-dialog';
import { BalanceDialog, BalanceDialogData } from './balance-dialog';
import {
  DividendDetails,
  Holdings,
  InvestmentCard,
  InvestmentIncome,
  InvestmentService,
  InvestmentSummary,
} from './investment-service';

/** One section of accounts, with its totals (used by both the list and the cards). */
export interface AccountGroup {
  key: string;
  title: string;
  cards: InvestmentCard[];
  value: number;
  putIn: number;
  gain: number;
  /** HYSA / savings: the gain is the interest entered. */
  cashOnly: boolean;
}

const KIND_TO_SLICE: Record<string, { key: string; label: string }> = {
  brokerage: { key: 'stocks', label: 'Stocks' },
  retirement: { key: 'retirement', label: '401K' },
  cash: { key: 'cash', label: 'HYSA & savings' },
  crypto: { key: 'crypto', label: 'Crypto' },
  hsa: { key: 'hsa', label: 'HSA' },
  property: { key: 'property', label: 'Real estate' },
  metal: { key: 'other', label: 'Gold & other' },
  other: { key: 'other', label: 'Gold & other' },
};

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: 'Brokerage and crypto', kinds: ['brokerage', 'crypto'] },
  { title: 'Cash: HYSA and savings', kinds: ['cash'] },
  { title: 'Retirement and HSA', kinds: ['retirement', 'hsa'] },
  { title: 'Property and gold', kinds: ['property', 'metal', 'other'] },
  // Children's accounts get one section per child (see load()).
];
const ALLOCATION_COLORS: Record<string, string> = {
  stocks: '#2f6fd0',
  retirement: '#0f5c4d',
  cash: '#c98312',
  crypto: '#7a5cc2',
  hsa: '#3b8fa8',
  property: '#d2493f',
  other: '#8a7e63',
  children: '#e0779a',
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
  /** Which tab: SCP & SJ's own accounts, or the children's accounts. */
  tab: 'household' | 'children' = 'household';
  householdGroups: AccountGroup[] = [];
  childGroups: AccountGroup[] = [];
  /** List (compact rows) or the cards. Remembered in this browser. */
  view: 'list' | 'cards' = 'list';
  /** SCP & SJ tab: '' = both, or one person's accounts only. */
  ownerFilter: '' | 'SCP' | 'SJ' = '';
  private collapsed = new Set<string>();
  private ownAccounts: InvestmentCard[] = [];
  hh = this.emptyTotals();
  kids = { ...this.emptyTotals(), byChild: [] as { name: string; value: number }[], accounts: 0 };
  hhAllocation: InvestmentSummary['allocation'] = [];
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
  /** "Each dividend payment" table (loaded when opened). */
  showDetails = false;
  details: DividendDetails | null = null;
  detailsState: 'idle' | 'loading' | 'ready' | 'unavailable' = 'idle';

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
    try {
      const saved = localStorage.getItem('investments.view');
      if (saved === 'cards' || saved === 'list') this.view = saved;
    } catch {
      /* storage unavailable: default to the list */
    }
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
        this.ownAccounts = data.accounts.filter((a) => a.kind !== 'child');
        const children = data.accounts.filter((a) => a.kind === 'child');
        this.buildHousehold();
        // Children tab: one section per child, each with its own subtotal
        const names = [...new Set(children.map((a) => a.beneficiary || 'Child'))].sort();
        this.childGroups = names.map((name) =>
          this.makeGroup(`child:${name}`, `For ${name}`, children.filter((a) => (a.beneficiary || 'Child') === name)),
        );
        this.kids = {
          ...this.totalsOf(children),
          byChild: this.childGroups.map((g) => ({ name: g.title.replace(/^For /, ''), value: g.value })),
          accounts: children.length,
        };
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

  setTab(tab: 'household' | 'children'): void {
    this.tab = tab;
  }

  setView(view: 'list' | 'cards'): void {
    this.view = view;
    try {
      localStorage.setItem('investments.view', view);
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  }

  setOwnerFilter(owner: '' | 'SCP' | 'SJ'): void {
    this.ownerFilter = owner;
    this.buildHousehold();
  }

  toggleGroup(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
  }

  isCollapsed(key: string): boolean {
    return this.collapsed.has(key);
  }

  /** SCP & SJ tab: groups, totals and allocation for the chosen owner(s). */
  private buildHousehold(): void {
    const own = this.ownAccounts.filter((a) => !this.ownerFilter || a.owner === this.ownerFilter);
    this.householdGroups = GROUPS.map((g) =>
      this.makeGroup(g.title, g.title, own.filter((a) => g.kinds.includes(a.kind) && this.showCard(a))),
    ).filter((g) => g.cards.length);
    this.hh = this.totalsOf(own);
    const slices = new Map<string, { key: string; label: string; value: number; pct: number }>();
    for (const a of own) {
      const sl = KIND_TO_SLICE[a.kind];
      if (!sl || !a.value || a.value <= 0) continue;
      const cur = slices.get(sl.key) ?? { ...sl, value: 0, pct: 0 };
      cur.value += a.value;
      slices.set(sl.key, cur);
    }
    const sum = [...slices.values()].reduce((t, x) => t + x.value, 0);
    const order = ['stocks', 'retirement', 'cash', 'crypto', 'hsa', 'property', 'other'];
    this.hhAllocation = order
      .filter((k) => slices.has(k))
      .map((k) => {
        const x = slices.get(k)!;
        return { ...x, pct: sum > 0 ? Math.round((x.value / sum) * 1000) / 10 : 0 };
      });
  }

  private makeGroup(key: string, title: string, cards: InvestmentCard[]): AccountGroup {
    const t = this.totalsOf(cards);
    return {
      key,
      title,
      cards,
      value: t.value,
      putIn: t.putIn,
      gain: t.gain,
      cashOnly: cards.length > 0 && cards.every((c) => c.kind === 'cash'),
    };
  }

  private emptyTotals() {
    return { value: 0, putIn: 0, gain: 0, gainPct: null as number | null, estimated: 0 };
  }

  /** Value, money put in and gain over some accounts (same rules as the overall totals). */
  private totalsOf(cards: InvestmentCard[]) {
    const t = this.emptyTotals();
    for (const c of cards) {
      if (c.value == null) continue;
      t.value += c.value;
      if (c.put_in != null) t.putIn += c.put_in;
      if (c.estimated) t.estimated += 1;
    }
    t.gain = t.value - t.putIn;
    t.gainPct = t.putIn > 0 ? (t.gain / t.putIn) * 100 : null;
    return t;
  }

  /** Accounts with no data at all (e.g. an unused savings account) stay hidden. */
  private showCard(a: InvestmentCard): boolean {
    if (a.kind === 'property' || a.kind === 'child' || a.tracks_holdings) return true;
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
    if (this.showDetails) this.loadDetails();
  }

  toggleDetails(): void {
    this.showDetails = !this.showDetails;
    if (this.showDetails) this.loadDetails();
  }

  private loadDetails(): void {
    this.detailsState = 'loading';
    this.invest.dividendDetails(this.incomeYear, this.incomeOwner).subscribe({
      next: (d) => {
        this.details = d;
        this.detailsState = 'ready';
      },
      error: () => {
        this.details = null;
        this.detailsState = 'unavailable';
      },
    });
  }

  rowsOf(month: string): DividendDetails['rows'] {
    return this.details?.rows.filter((r) => r.month === month) ?? [];
  }

  perShare(n: number | null): string {
    if (n == null) return '—';
    return '$' + n.toFixed(n < 1 ? 4 : 2);
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

  /** From the list's menu: show that account's holdings and scroll to them. */
  showHoldings(categoryId: number): void {
    this.selectHoldings(categoryId);
    setTimeout(() => document.getElementById('holdings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /** Add a new account (no card) or edit one (card). */
  openAccount(card?: InvestmentCard): void {
    const data: AccountDialogData = { card };
    this.dialog
      .open(AccountDialog, { width: '560px', maxWidth: '94vw', autoFocus: 'dialog', data })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.load();
          this.loadIncome();
        }
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
