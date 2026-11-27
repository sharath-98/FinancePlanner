// FILE: src/app/transactions/transactions.ts  (REPLACE existing file)
import { Component, OnInit, ViewChild } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormGroupDirective,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatSelectChange } from '@angular/material/select';
import {
  type CellClassParams,
  type CellClickedEvent,
  type CellStyle,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ICellRendererParams,
  type ProcessCellForExportParams,
} from 'ag-grid-community';
import { ToastrService } from 'ngx-toastr';
import { Observable, combineLatest, map, startWith } from 'rxjs';
import { TransactionService } from './transaction-service';
import { AuthService } from '../auth/auth.service';
import { MatDialog } from '@angular/material/dialog';
import { CategoryManagerDialog } from './category-manager-dialog';
import { EntryFinderDialog } from './entry-finder-dialog';
import { TransactionActions } from './transaction-actions';
import { gridTheme, moneyFormatter } from '../shared/grid-theme';
import { formatUsd, formatUsdExact } from '../shared/design-tokens';
import { FormControl } from '@angular/forms';
import { InvestmentOptions, InvestmentService, localIso } from '../investments/investment-service';
import { MoveMoneyDialog } from '../investments/move-money-dialog';

interface Category {
  id: number;
  name: string;
  type: string;
}

interface SummaryCard {
  key: string;
  label: string;
  value: number;
  note: string;
  /** Class from styles.scss that sets the card's accent color */
  tone: 'tone-income' | 'tone-expense' | 'tone-savings' | 'tone-debt';
}

interface MerchantSpend {
  name: string;
  amount: number;
  count: number;
  /** Bar length as a percent of the biggest merchant in the category */
  width: number;
}

interface CategorySlice {
  name: string;
  amount: number;
  /** Share of all expenses in the period, in percent */
  share: number;
  /** Position in the chart, used to pick the slice color */
  index: number;
  /** True for the slice that groups the smaller categories */
  isOther: boolean;
  /** For the "Other" slice, the categories folded into it */
  folded: string[];
  /** Outline of the slice in the donut */
  path: string;
  merchants: MerchantSpend[];
  /** Merchants beyond the ones listed, added together */
  moreCount: number;
  moreAmount: number;
}

/** Transaction types as stored in the database, with the words shown on screen. */
const TYPE_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  saving: 'Savings',
  debt: 'Debt',
};
const TYPE_ORDER = ['expense', 'income', 'saving', 'debt'];
const TYPE_COLORS: Record<string, string> = {
  expense: 'var(--expense)',
  income: 'var(--income)',
  saving: 'var(--savings)',
  debt: 'var(--debt)',
};

/** The category box must hold a category picked from the list, not free text. */
function categoryPicked(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  return value && typeof value === 'object' && value.id ? null : { categoryPicked: true };
}

/** The API sends dates as MM-DD-YYYY text; sort them as real dates. */
function dateKey(value?: string): number {
  if (!value) return 0;
  const [month, day, year] = value.split('-').map(Number);
  return year * 10000 + month * 100 + day;
}

@Component({
  selector: 'app-transactions',
  standalone: false,
  templateUrl: './transactions.html',
  styleUrl: './transactions.css',
  // Full dates (day included) in the date picker, whatever the rest of the app uses
  providers: [provideNativeDateAdapter()],
})
export class Transactions implements OnInit {
  @ViewChild(FormGroupDirective) formDir!: FormGroupDirective;

  categories: Category[] = [];
  types: string[] = [];
  currencies = ['USD'];
  users: { id: number; name: string }[] = [];

  transactionForm: FormGroup;
  filteredCategories!: Observable<Category[]>;
  merchants: string[] = [];
  filteredMerchants: string[] = [];
  isNewMerchantEntry = false;

  saving = false;

  /* ---------- Investments (Phase 6): extra fields for Stocks/Crypto and Dividends categories ---------- */
  investOptions: InvestmentOptions | null = null;
  usdExact = formatUsdExact;
  tradeForm!: FormGroup;
  dividendSymbol = new FormControl<string>('', { nonNullable: true });
  /** On phones the form is collapsed until "Add transaction" is tapped. */
  formOpen = false;

  years: number[] = [];
  selectedYear!: number;
  /** 0 means the whole year; otherwise 1-12. Starts on the current month. */
  selectedMonth = new Date().getMonth() + 1;
  readonly months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  /** Every transaction in the selected year. */
  private allRows: any[] = [];
  /** The rows for the chosen month (or the whole year). Totals and top categories use these. */
  private monthRows: any[] = [];
  /** What the grid shows: monthRows, narrowed to one category when a top category is selected. */
  rowData: any[] = [];
  rowsLoaded = false;

  usd = formatUsd;
  summaryCards: SummaryCard[] = [];
  /** Expense categories drawn in the donut, biggest first. */
  slices: CategorySlice[] = [];
  expenseTotal = 0;
  /** The slice under the pointer, and the one the person selected. */
  hoveredName = '';
  pinnedName = '';
  private gridApi?: GridApi;
  selectedCategory = '';
  search = '';

  theme = gridTheme('neutral');

  /** Column choices for small screens are made once, when the page loads. */
  private isPhone = window.matchMedia('(max-width: 720px)').matches;

  colDefs: ColDef[] = [
    {
      field: 'date',
      headerName: 'Date',
      minWidth: 120,
      flex: 1,
      comparator: (a: string, b: string) => dateKey(a) - dateKey(b),
      sort: 'desc',
    },
    {
      field: 'type',
      headerName: 'Type',
      hide: this.isPhone,
      minWidth: 110,
      flex: 1,
      valueFormatter: (p) => TYPE_LABELS[p.value] ?? p.value,
      cellStyle: (p: CellClassParams): CellStyle | null => {
        const color = TYPE_COLORS[p.value];
        return color ? { color, fontWeight: 600 } : null;
      },
    },
    { field: 'category', headerName: 'Category', minWidth: this.isPhone ? 160 : 200, flex: 2 },
    { field: 'merchant', headerName: 'Merchant', minWidth: this.isPhone ? 140 : 180, flex: 2 },
    {
      field: 'amount',
      headerName: 'Amount',
      type: 'rightAligned',
      minWidth: 120,
      flex: 1,
      valueFormatter: moneyFormatter,
    },
    { field: 'details', headerName: 'Details', hide: this.isPhone, minWidth: 240, flex: 3 },
    {
      // Edit and delete buttons for each row; clicks are handled in onCellClicked
      colId: 'actions',
      headerName: '',
      width: 100,
      pinned: 'right',
      lockPinned: true,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
      cellRenderer: (params: ICellRendererParams) => this.actionButtons(params),
    },
  ];

  defaultColDef: ColDef = {
    filter: true,
    sortable: true,
    resizable: true,
    editable: false, // there is no update endpoint yet, so edits would not be saved
  };

  constructor(
    private transSrv: TransactionService,
    private toastr: ToastrService,
    private fb: FormBuilder,
    private auth: AuthService,
    private dialog: MatDialog,
    private actions: TransactionActions,
    private invest: InvestmentService,
  ) {
    this.tradeForm = this.fb.group({
      side: ['buy'],
      symbol: [''],
      assetType: ['stock'],
      name: [''],
      quoteId: [''],
      quantity: [null as number | null],
      price: [null as number | null],
      fees: [null as number | null],
      funding: ['new_money'],
      fromCategoryId: [null as number | null],
      destination: ['keep'],
      toCategoryId: [null as number | null],
    });
    this.transactionForm = this.fb.group({
      type: ['expense', Validators.required],
      category: ['', [Validators.required, categoryPicked]],
      merchant: ['', Validators.required],
      date: [new Date(), Validators.required],
      amount: ['', [Validators.required, Validators.min(0.01)]],
      // When signed in, the payer starts as the logged-in person
      paidby: [this.auth.currentUser?.id ?? '', Validators.required],
      currency: ['USD', Validators.required],
      details: [''],
    });
  }

  ngOnInit(): void {
    const currentYear = new Date().getFullYear();
    this.selectedYear = currentYear;
    for (let y = currentYear; y >= currentYear - 10; y--) {
      this.years.push(y);
    }

    this.transSrv.get_users().subscribe((data) => {
      this.users = Array.isArray(data) ? data : [];
    });

    this.loadCategories();

    const typeControl = this.transactionForm.get('type')!;
    const categoryControl = this.transactionForm.get('category')!;
    const merchantControl = this.transactionForm.get('merchant')!;

    // Category choices follow the selected type
    this.filteredCategories = combineLatest([
      typeControl.valueChanges.pipe(startWith(typeControl.value)),
      categoryControl.valueChanges.pipe(startWith(categoryControl.value)),
    ]).pipe(
      map(([type, category]) =>
        this.filterCategories(type, typeof category === 'string' ? category : category?.name),
      ),
    );

    // Changing the type clears the category and merchant, which belong to the old type
    typeControl.valueChanges.subscribe(() => {
      categoryControl.setValue('');
      merchantControl.setValue('');
      this.clearMerchants();
    });

    merchantControl.valueChanges.subscribe((value) => this.onMerchantInput(value));

    // Investments: show the Buy/Sell or Dividend fields for the matching categories
    this.loadInvestOptions();
    categoryControl.valueChanges.subscribe(() => this.syncInvestMode());
    this.tradeForm.valueChanges.subscribe(() => this.syncInvestMode());

    this.loadTransactions();
  }

  /* ---------- Form helpers ---------- */

  private loadCategories(): void {
    this.transSrv.get_categories().subscribe((data) => {
      this.categories = data?.['categories'] ?? [];
      const types: string[] = data?.['types'] ?? [];
      this.types = [...types].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
      // Re-run the category filter now that the list has arrived
      this.transactionForm.get('category')!.updateValueAndValidity();
    });
  }

  /** Opens the categories and merchants search; the category list reloads when one is added. */
  openCategories(): void {
    this.dialog.open(CategoryManagerDialog, {
      width: '680px',
      maxWidth: '94vw',
      maxHeight: '90vh',
      autoFocus: 'dialog',
      data: { onAdded: () => this.loadCategories() },
    });
  }

  /** Opens the search for finding an entry to edit or delete; the list reloads after a change. */
  openEntryFinder(): void {
    this.dialog.open(EntryFinderDialog, {
      width: '720px',
      maxWidth: '94vw',
      maxHeight: '92vh',
      autoFocus: 'dialog',
      data: {
        categories: this.categories,
        users: this.users,
        onChanged: () => this.loadTransactions(),
      },
    });
  }

  /** The pencil and bin buttons shown at the end of every row. */
  private actionButtons(params: ICellRendererParams): HTMLElement {
    const box = document.createElement('div');
    box.className = 'row-actions';
    if (params.data?.id == null) return box;

    const make = (action: 'edit' | 'delete', icon: string, label: string) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `row-action-btn ${action}`;
      button.dataset['action'] = action;
      button.setAttribute('aria-label', `${label} ${params.data.merchant}`);
      button.title = label;
      const glyph = document.createElement('span');
      glyph.className = 'material-icons';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = icon;
      button.appendChild(glyph);
      return button;
    };
    box.append(make('edit', 'edit', 'Edit'), make('delete', 'delete', 'Delete'));
    return box;
  }

  /** True while an edit or delete is being opened, so a double tap cannot start it twice. */
  private rowActionBusy = false;

  onCellClicked(event: CellClickedEvent): void {
    if (event.colDef.colId !== 'actions' || this.rowActionBusy || event.data?.id == null) return;
    const button = (event.event?.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-action]',
    );
    if (!button) return;

    const action = button.dataset['action'];
    this.rowActionBusy = true;
    this.actions.loadEntry(Number(event.data.id)).subscribe({
      next: (entry) => {
        if (!entry) {
          this.rowActionBusy = false;
          this.toastr.error('That transaction no longer exists.');
          this.loadTransactions();
          return;
        }
        if (action === 'edit') {
          this.actions.edit(entry, this.categories, this.users, () => this.loadTransactions());
          this.rowActionBusy = false;
        } else {
          this.actions.remove(
            entry,
            () => this.loadTransactions(),
            () => (this.rowActionBusy = false),
          );
        }
      },
      error: () => {
        this.rowActionBusy = false;
        this.toastr.error('Could not open that transaction. Check that the API is running.');
      },
    });
  }

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  displayCategory(category: any): string {
    return category && category.name ? category.name.trim() : '';
  }

  private filterCategories(type: string, text?: string): Category[] {
    const needle = (text ?? '').toLowerCase();
    return this.categories.filter(
      (c) => (!type || c.type === type) && c.name.toLowerCase().includes(needle),
    );
  }

  onCategorySelected(): void {
    const category = this.transactionForm.value.category;
    this.clearMerchants();
    this.transactionForm.patchValue({ merchant: '' });

    if (!category?.id) return;
    this.transSrv.get_subcategory({ category_id: category.id }).subscribe((data) => {
      this.merchants = Array.isArray(data) ? data : [];
      this.filteredMerchants = [...this.merchants];
    });
  }

  private clearMerchants(): void {
    this.merchants = [];
    this.filteredMerchants = [];
    this.isNewMerchantEntry = false;
  }

  private onMerchantInput(value: string): void {
    const text = (value ?? '').trim().toLowerCase();
    this.filteredMerchants = this.merchants.filter((m) => m.toLowerCase().includes(text));
    const hasCategory = !!this.transactionForm.value.category?.id;
    this.isNewMerchantEntry =
      hasCategory && text.length > 0 && !this.merchants.some((m) => m.toLowerCase() === text);
  }

  addNewMerchant(): void {
    const { category, merchant } = this.transactionForm.value;
    const name = String(merchant ?? '').trim();
    if (!category?.id || !name) return;

    this.transSrv.save_subcategory({ category_id: category.id, merchant: name }).subscribe({
      next: (rows) => {
        this.merchants = Array.isArray(rows)
          ? rows.map((r: any) => r.merchant)
          : [...this.merchants, name];
        this.filteredMerchants = [...this.merchants];
        this.isNewMerchantEntry = false;
        this.toastr.success('Merchant added.');
      },
      error: () =>
        this.toastr.error(
          'Could not add the merchant. Check that the API is running and try again.',
        ),
    });
  }

  /* ---------- Save and reset ---------- */

  onSubmit(): void {
    if (this.transactionForm.invalid || this.saving) return;
    if (this.tradeMode) {
      this.submitTrade();
      return;
    }
    if (this.dividendMode) {
      this.submitDividend();
      return;
    }

    const value = this.transactionForm.value;
    const payload = {
      transaction: {
        ...value,
        date: new Date(value.date).toISOString(),
        details: value.details ?? '',
      },
    };

    this.saving = true;
    this.transSrv.save_expense(payload).subscribe({
      next: () => {
        this.saving = false;
        this.toastr.success('Transaction saved.');
        // Keep type, date, payer and currency so a run of entries is quick to enter
        this.formDir.resetForm({
          ...this.defaultValues(),
          type: value.type,
          date: value.date,
          paidby: value.paidby,
          currency: value.currency,
        });
        this.clearMerchants();
        this.formOpen = false;
        this.showMonthOf(value.date);
        this.loadTransactions();
      },
      error: () => {
        this.saving = false;
        this.toastr.error(
          'Could not save the transaction. Check the fields and that the API is running.',
        );
      },
    });
  }

  onReset(): void {
    this.formDir.resetForm(this.defaultValues());
    this.clearMerchants();
    this.resetInvestFields();
  }

  /* ---------- Investments (Phase 6) ---------- */

  private loadInvestOptions(): void {
    this.invest.options().subscribe({
      next: (o) => {
        this.investOptions = o;
        this.syncInvestMode();
      },
      error: () => (this.investOptions = null), // API without Phase 6: the form works as before
    });
  }

  private get selectedCategoryId(): number | null {
    const c = this.transactionForm?.get('category')?.value;
    return c && typeof c === 'object' && c.id ? Number(c.id) : null;
  }

  /** The investment account behind the selected Saving category, when it tracks shares. */
  get tradeAccount(): InvestmentOptions['accounts'][number] | null {
    const id = this.selectedCategoryId;
    if (!id || !this.investOptions || this.transactionForm.get('type')!.value !== 'saving') return null;
    return this.investOptions.accounts.find((a) => a.category_id === id && a.tracks_holdings) ?? null;
  }

  /** The dividends category selected, with the account it is paid into. */
  get dividendCategory(): InvestmentOptions['dividend_categories'][number] | null {
    const id = this.selectedCategoryId;
    if (!id || !this.investOptions || this.transactionForm.get('type')!.value !== 'income') return null;
    return this.investOptions.dividend_categories.find((d) => d.income_category_id === id) ?? null;
  }

  get tradeMode(): boolean {
    return !!this.tradeAccount;
  }

  get dividendMode(): boolean {
    return !!this.dividendCategory;
  }

  get isCrypto(): boolean {
    return this.tradeAccount?.kind === 'crypto';
  }

  get isBuy(): boolean {
    return this.tradeForm.value.side !== 'sell';
  }

  /** Stocks/coins already known that fit this account (for the Buy list). */
  get symbolChoices(): InvestmentOptions['securities'] {
    const text = String(this.tradeForm.value.symbol ?? '').trim().toUpperCase();
    return (this.investOptions?.securities ?? [])
      .filter((s) => (this.isCrypto ? s.asset_type === 'crypto' : s.asset_type !== 'crypto'))
      .filter((s) => !text || s.symbol.startsWith(text) || (s.name ?? '').toUpperCase().includes(text))
      .slice(0, 20);
  }

  /** What this account holds (for the Sell list). */
  get heldChoices(): InvestmentOptions['accounts'][number]['held'] {
    return this.tradeAccount?.held ?? [];
  }

  /** Symbols for "Stock that paid it": what the account holds first, then other known symbols
   *  (e.g. SPAXX, Fidelity's cash fund, which pays dividends but is not a holding). */
  get dividendChoices(): string[] {
    const d = this.dividendCategory;
    const account = this.investOptions?.accounts.find((a) => a.category_id === d?.account_category_id);
    const held = (account?.held ?? []).map((h) => h.symbol);
    const wantCrypto = account?.kind === 'crypto';
    const others = (this.investOptions?.securities ?? [])
      .filter((s) => (s.asset_type === 'crypto') === wantCrypto && !held.includes(s.symbol))
      .map((s) => s.symbol);
    return [...held, ...others];
  }

  /** Accounts money can come from / go to (not this one). */
  get otherAccounts(): InvestmentOptions['accounts'] {
    const id = this.tradeAccount?.category_id;
    return (this.investOptions?.accounts ?? []).filter((a) => a.category_id !== id);
  }

  get newSymbol(): boolean {
    const sym = String(this.tradeForm.value.symbol ?? '').trim().toUpperCase();
    return !!sym && this.isBuy && !(this.investOptions?.securities ?? []).some((s) => s.symbol === sym);
  }

  get heldOfSelected(): number | null {
    const sym = String(this.tradeForm.value.symbol ?? '').toUpperCase();
    return this.heldChoices.find((h) => h.symbol === sym)?.quantity ?? null;
  }

  /** Shares x price, plus fees on a buy / minus fees on a sale. */
  get tradeTotal(): number {
    const q = Number(this.tradeForm.value.quantity) || 0;
    const p = Number(this.tradeForm.value.price) || 0;
    const f = Number(this.tradeForm.value.fees) || 0;
    const gross = Math.round(q * p * 100) / 100;
    return this.isBuy ? gross + f : Math.max(0, gross - f);
  }

  /** On a sale: proceeds minus the average cost of the shares sold. */
  get saleGain(): number | null {
    if (this.isBuy) return null;
    const sym = String(this.tradeForm.value.symbol ?? '').toUpperCase();
    const held = this.heldChoices.find((h) => h.symbol === sym);
    const q = Number(this.tradeForm.value.quantity) || 0;
    if (!held || !q) return null;
    return this.tradeTotal - held.avg_cost * q;
  }

  /** Merchant and amount only matter where a normal transaction is saved. */
  private syncInvestMode(): void {
    if (!this.transactionForm) return;
    const merchant = this.transactionForm.get('merchant')!;
    const amount = this.transactionForm.get('amount')!;
    const trade = this.tradeMode;
    const needsMerchant = !trade || (this.isBuy && this.tradeForm.value.funding === 'new_money');
    if (needsMerchant && merchant.disabled) merchant.enable({ emitEvent: false });
    if (!needsMerchant && merchant.enabled) merchant.disable({ emitEvent: false });
    if (trade) {
      if (amount.enabled) amount.disable({ emitEvent: false });
      amount.setValue(this.tradeTotal || '', { emitEvent: false });
    } else if (amount.disabled) {
      amount.enable({ emitEvent: false });
      amount.setValue('', { emitEvent: false });
    }
  }

  private resetInvestFields(): void {
    this.tradeForm.reset(
      { side: 'buy', symbol: '', assetType: 'stock', name: '', quoteId: '', quantity: null, price: null,
        fees: null, funding: 'new_money', fromCategoryId: null, destination: 'keep', toCategoryId: null },
      { emitEvent: false },
    );
    this.dividendSymbol.setValue('');
    this.syncInvestMode();
  }

  private submitTrade(): void {
    const account = this.tradeAccount!;
    const t = this.tradeForm.value;
    const value = this.transactionForm.getRawValue();
    const symbol = String(t.symbol ?? '').trim().toUpperCase();
    const problem =
      !symbol ? 'Enter the symbol.' :
      !(Number(t.quantity) > 0) ? 'Enter the number of shares.' :
      !(Number(t.price) >= 0) || t.price === null || t.price === '' ? 'Enter the price per share.' :
      this.isBuy && t.funding === 'transfer' && !t.fromCategoryId ? 'Choose the account the money comes from.' :
      !this.isBuy && t.destination === 'transfer' && !t.toCategoryId ? 'Choose the account the cash goes to.' :
      this.newSymbol && this.isCrypto && !String(t.quoteId ?? '').trim() ? 'For a new coin, enter its CoinGecko id (e.g. bitcoin).' :
      null;
    if (problem) {
      this.toastr.warning(problem);
      return;
    }
    const trade: any = {
      category_id: account.category_id,
      side: this.isBuy ? 'buy' : 'sell',
      symbol,
      quantity: Number(t.quantity),
      price: Number(t.price),
      fees: Number(t.fees) || 0,
      date: localIso(value.date),
      notes: value.details ?? '',
    };
    if (this.newSymbol) {
      trade.asset_type = this.isCrypto ? 'crypto' : t.assetType;
      trade.name = String(t.name ?? '').trim();
      if (this.isCrypto) trade.quote_id = String(t.quoteId ?? '').trim().toLowerCase();
    }
    if (this.isBuy) {
      trade.funding = t.funding;
      if (t.funding === 'new_money') {
        trade.transaction = { paidby: value.paidby, merchant: value.merchant, details: value.details ?? '' };
      }
      if (t.funding === 'transfer') trade.from_category_id = t.fromCategoryId;
    } else {
      trade.destination = t.destination;
      if (t.destination === 'transfer') trade.to_category_id = t.toCategoryId;
    }
    this.saving = true;
    this.invest.saveTrade(trade).subscribe({
      next: () => this.afterInvestSave(value, this.isBuy ? `Bought ${trade.quantity} ${symbol}.` : `Sold ${trade.quantity} ${symbol}.`),
      error: (err) => {
        this.saving = false;
        this.toastr.error(err?.error?.error ?? 'Could not save the trade.');
      },
    });
  }

  private submitDividend(): void {
    const symbol = this.dividendSymbol.value;
    if (!symbol) {
      this.toastr.warning('Choose the stock that paid the dividend.');
      return;
    }
    const value = this.transactionForm.getRawValue();
    const transaction = { ...value, date: new Date(value.date).toISOString(), details: value.details ?? '' };
    this.saving = true;
    this.invest.saveDividend(transaction, symbol).subscribe({
      next: () => this.afterInvestSave(value, `Dividend from ${symbol} saved.`),
      error: (err) => {
        this.saving = false;
        this.toastr.error(err?.error?.error ?? 'Could not save the dividend.');
      },
    });
  }

  /** Same reset as a normal save, keeping the category so a run of trades is quick to enter. */
  private afterInvestSave(value: any, message: string): void {
    this.saving = false;
    this.toastr.success(message);
    this.formDir.resetForm({
      ...this.defaultValues(),
      type: value.type,
      category: value.category,
      merchant: value.merchant ?? '',
      date: value.date,
      paidby: value.paidby,
      currency: value.currency,
    });
    const side = this.tradeForm.value.side;
    this.resetInvestFields();
    this.tradeForm.patchValue({ side }, { emitEvent: false });
    this.showMonthOf(value.date);
    this.loadTransactions();
    this.loadInvestOptions();
  }

  /** Moves between investment accounts (HYSA -> Real Estate, ...) or out to spend. */
  openMoveMoney(): void {
    this.dialog.open(MoveMoneyDialog, { width: '560px', maxWidth: '94vw', autoFocus: 'dialog' });
  }

  private defaultValues() {
    return {
      type: 'expense',
      category: '',
      merchant: '',
      date: new Date(),
      amount: '',
      paidby: this.auth.currentUser?.id ?? '',
      currency: 'USD',
      details: '',
    };
  }

  /* ---------- Grid ---------- */

  onYearChange(event: MatSelectChange): void {
    this.selectedYear = event.value;
    this.selectedCategory = '';
    this.loadTransactions();
  }

  onMonthChange(event: MatSelectChange): void {
    this.selectedMonth = event.value;
    this.selectedCategory = '';
    this.applyMonthFilter();
  }

  /** "November 2026", or just "2026" when the whole year is shown. */
  get periodLabel(): string {
    return this.selectedMonth === 0
      ? String(this.selectedYear)
      : `${this.months[this.selectedMonth - 1]} ${this.selectedYear}`;
  }

  /** After saving, jump to the month of the new transaction so it is visible in the list. */
  private showMonthOf(date: Date | string): void {
    this.selectedCategory = '';
    const saved = new Date(date);
    if (this.years.includes(saved.getFullYear())) {
      this.selectedYear = saved.getFullYear();
      if (this.selectedMonth !== 0) {
        this.selectedMonth = saved.getMonth() + 1;
      }
    }
  }

  /** Rows arrive as MM-DD-YYYY text, so the month is the part before the first dash. */
  private monthOf(row: any): number {
    return Number(String(row.date).split('-')[0]);
  }

  private applyMonthFilter(): void {
    this.monthRows =
      this.selectedMonth === 0
        ? this.allRows
        : this.allRows.filter((row) => this.monthOf(row) === this.selectedMonth);
    this.buildSummary();
    this.applyCategoryFilter();
  }

  private applyCategoryFilter(): void {
    this.rowData = this.selectedCategory
      ? this.monthRows.filter((row) => String(row.category).trim() === this.selectedCategory)
      : this.monthRows;
  }

  /** Tapping a top category narrows the list to it; tapping it again shows everything. */
  toggleCategory(name: string): void {
    this.selectedCategory = this.selectedCategory === name ? '' : name;
    this.applyCategoryFilter();
  }

  clearCategory(): void {
    this.selectedCategory = '';
    this.applyCategoryFilter();
  }

  /** Sums amounts per transaction type (the API may send amounts as text, so convert). */
  private totals(rows: any[]): Record<string, number> {
    const sums: Record<string, number> = { income: 0, expense: 0, saving: 0, debt: 0 };
    for (const row of rows) {
      if (row.type in sums) {
        sums[row.type] += Number(row.amount) || 0;
      }
    }
    return sums;
  }

  /** Builds the summary cards and top expense categories from the rows for the period shown. */
  private buildSummary(): void {
    const current = this.totals(this.monthRows);

    // Compare with the month before, when it is in the same year (so not for January or All year)
    const canCompare = this.selectedMonth >= 2;
    const previous = canCompare
      ? this.totals(this.allRows.filter((row) => this.monthOf(row) === this.selectedMonth - 1))
      : null;
    const previousName = canCompare ? this.months[this.selectedMonth - 2] : '';

    const change = (key: string): string | null => {
      if (!previous) return null;
      const before = previous[key];
      if (before === 0) return `None recorded in ${previousName}`;
      const pct = Math.round(((current[key] - before) / before) * 100);
      if (pct === 0) return `Same as ${previousName}`;
      return pct > 0
        ? `Up ${pct}% from ${previousName}`
        : `Down ${Math.abs(pct)}% from ${previousName}`;
    };

    const countNote = (type: string): string => {
      const n = this.monthRows.filter((row) => row.type === type).length;
      return `${n} ${n === 1 ? 'transaction' : 'transactions'}`;
    };

    this.summaryCards = [
      {
        key: 'expense',
        label: 'Expenses',
        value: current['expense'],
        tone: 'tone-expense',
        note: change('expense') ?? countNote('expense'),
      },
      {
        key: 'income',
        label: 'Income',
        value: current['income'],
        tone: 'tone-income',
        note: change('income') ?? countNote('income'),
      },
      {
        key: 'saving',
        label: 'Savings',
        value: current['saving'],
        tone: 'tone-savings',
        note: change('saving') ?? countNote('saving'),
      },
      {
        key: 'debt',
        label: 'Debt',
        value: current['debt'],
        tone: 'tone-debt',
        note: change('debt') ?? countNote('debt'),
      },
    ];

    this.buildCategoryChart(current['expense']);
  }

  /** Groups the period's expenses by category, then by merchant inside each category. */
  private buildCategoryChart(expenseTotal: number): void {
    const MAX_SLICES = 7; // one color each; the rest are grouped as "Other"
    const MAX_MERCHANTS = 8;

    type Merchant = { name: string; amount: number; count: number };
    type Group = { name: string; amount: number; merchants: Map<string, Merchant> };
    const groups = new Map<string, Group>();
    for (const row of this.monthRows) {
      if (row.type !== 'expense') continue;
      const amount = Number(row.amount) || 0;
      const category = String(row.category ?? '').trim() || 'Uncategorized';
      const group = groups.get(category) ?? { name: category, amount: 0, merchants: new Map() };
      group.amount += amount;
      // The same merchant in different capitals counts once
      const merchant = String(row.merchant ?? '').trim() || 'No merchant';
      const key = merchant.toLowerCase();
      const entry = group.merchants.get(key) ?? { name: merchant, amount: 0, count: 0 };
      entry.amount += amount;
      entry.count += 1;
      group.merchants.set(key, entry);
      groups.set(category, group);
    }

    const sorted = [...groups.values()]
      .filter((g) => g.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const named = sorted.length > MAX_SLICES + 1 ? sorted.slice(0, MAX_SLICES) : sorted;
    const rest = sorted.slice(named.length);

    const entries: {
      name: string;
      amount: number;
      isOther: boolean;
      folded: string[];
      merchants: Merchant[];
    }[] = named.map((g) => ({
      name: g.name,
      amount: g.amount,
      isOther: false,
      folded: [],
      merchants: [...g.merchants.values()],
    }));
    if (rest.length) {
      const merged = new Map<string, Merchant>();
      for (const g of rest) {
        for (const [key, m] of g.merchants) {
          const entry = merged.get(key) ?? { name: m.name, amount: 0, count: 0 };
          entry.amount += m.amount;
          entry.count += m.count;
          merged.set(key, entry);
        }
      }
      entries.push({
        name: 'Other',
        amount: rest.reduce((sum, g) => sum + g.amount, 0),
        isOther: true,
        folded: rest.map((g) => g.name),
        merchants: [...merged.values()],
      });
    }

    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    this.expenseTotal = expenseTotal;
    let start = 0;
    this.slices = entries.map((e, index) => {
      const fraction = total > 0 ? e.amount / total : 0;
      const path = this.arcPath(start, start + fraction);
      start += fraction;
      const merchants = e.merchants.sort((a, b) => b.amount - a.amount);
      const shown = merchants.slice(0, MAX_MERCHANTS);
      const hidden = merchants.slice(MAX_MERCHANTS);
      const biggest = shown.length ? shown[0].amount : 0;
      return {
        name: e.name,
        amount: e.amount,
        share: fraction * 100,
        index,
        isOther: e.isOther,
        folded: e.folded,
        path,
        merchants: shown.map((m) => ({
          ...m,
          width: biggest > 0 ? Math.max(3, (m.amount / biggest) * 100) : 0,
        })),
        moreCount: hidden.length,
        moreAmount: hidden.reduce((sum, m) => sum + m.amount, 0),
      };
    });

    // Forget a selection that is not in this period
    if (!this.slices.some((s) => s.name === this.pinnedName)) this.pinnedName = '';
    this.hoveredName = '';
  }

  /** SVG outline of a donut slice between two positions (0 to 1) around the circle, starting at the top. */
  private arcPath(from: number, to: number): string {
    const cx = 100,
      cy = 100,
      outer = 92,
      inner = 58;
    const point = (fraction: number, radius: number): string => {
      const angle = fraction * 2 * Math.PI - Math.PI / 2;
      return `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
    };
    if (to - from >= 0.9999) {
      // A full circle cannot be one arc, so draw two halves
      return (
        `M ${point(0, outer)} A ${outer} ${outer} 0 1 1 ${point(0.5, outer)} A ${outer} ${outer} 0 1 1 ${point(0, outer)} ` +
        `M ${point(0, inner)} A ${inner} ${inner} 0 1 0 ${point(0.5, inner)} A ${inner} ${inner} 0 1 0 ${point(0, inner)} Z`
      );
    }
    const large = to - from > 0.5 ? 1 : 0;
    return (
      `M ${point(from, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(to, outer)} ` +
      `L ${point(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(from, inner)} Z`
    );
  }

  /** The slice named in the panel: the one under the pointer, else the selected one, else the biggest. */
  get activeSlice(): CategorySlice | undefined {
    const name = this.hoveredName || this.pinnedName;
    return this.slices.find((s) => s.name === name) ?? this.slices[0];
  }

  /** True while a slice is hovered or selected, so the others can be dimmed. */
  get hasFocus(): boolean {
    return !!(this.hoveredName || this.pinnedName);
  }

  hoverSlice(name: string): void {
    this.hoveredName = name;
  }

  /** Selecting a slice keeps its merchants on screen; selecting it again lets go. */
  pinSlice(name: string): void {
    this.pinnedName = this.pinnedName === name ? '' : name;
  }

  shareLabel(share: number): string {
    return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
  }

  sliceLabel(s: CategorySlice): string {
    return `${s.name}: ${this.usd(s.amount)}, ${this.shareLabel(s.share)} of expenses`;
  }

  onGridReady(event: GridReadyEvent): void {
    this.gridApi = event.api;
  }

  /** Downloads what the list shows (the chosen month or year, after any filter or search) as a CSV file. */
  exportCsv(): void {
    if (!this.gridApi || !this.rowData.length) return;
    const stamp =
      this.selectedMonth === 0
        ? String(this.selectedYear)
        : `${this.selectedYear}-${String(this.selectedMonth).padStart(2, '0')}`;
    this.gridApi.exportDataAsCsv({
      fileName: `transactions-${stamp}.csv`,
      columnKeys: ['date', 'type', 'category', 'merchant', 'amount', 'details'],
      processCellCallback: (params): any => this.csvCell(params),
    });
  }

  /** Plain values for the file: ISO dates, numbers without $ or commas, and text that spreadsheets cannot run as formulas. */
  private csvCell(params: ProcessCellForExportParams): string | number {
    const field = params.column.getColId();
    const data = params.node?.data;
    if (field === 'amount') return Number(data?.amount) || 0;
    if (field === 'date') {
      const [month, day, year] = String(data?.date ?? '').split('-');
      return year ? `${year}-${month}-${day}` : '';
    }
    const text = params.value == null ? '' : String(params.value);
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  }

  loadTransactions(): void {
    this.transSrv.get_yearly_transactions({ year: this.selectedYear }).subscribe({
      next: (data) => {
        this.allRows = Array.isArray(data) ? data : [];
        this.applyMonthFilter();
        this.rowsLoaded = true;
      },
      error: () => {
        // The API answers with an error when a year has no transactions yet
        this.allRows = [];
        this.applyMonthFilter();
        this.rowsLoaded = true;
      },
    });
  }
}
