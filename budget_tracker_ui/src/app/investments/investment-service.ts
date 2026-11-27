// FILE: src/app/investments/investment-service.ts  (NEW file)
// Calls the Phase 6 investment routes. The auth interceptor adds the login token.
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

export type AccountKind =
  | 'brokerage' | 'crypto' | 'cash' | 'retirement' | 'hsa' | 'property' | 'metal' | 'other' | 'child';

export interface InvestmentCard {
  category_id: number;
  name: string;
  owner: 'SCP' | 'SJ';
  kind: AccountKind;
  /** The child a 529 / NJBEST / Trump Account is for. */
  beneficiary?: string | null;
  income_category_id?: number | null;
  debt_category_id?: number | null;
  institution: string | null;
  tracks_holdings: boolean;
  income_category: string | null;
  income_total: number;
  income_this_year: number;
  put_in_records: number;
  moved_in: number;
  moved_out: number;
  estimated: boolean;
  status: 'ok' | 'holdings_needed' | 'balance_needed' | 'value_needed';
  value: number | null;
  put_in: number | null;
  gain: number | null;
  source: string | null;
  as_of: string | null;
  cash?: number;
  positions?: number;
  missing_prices?: string[];
  realized_this_year?: number;
  home_value?: number;
  loan_category?: string | null;
  loan_left?: number | null;
  loan_set_up?: boolean;
}

export interface InvestmentSummary {
  as_of: string;
  totals: {
    value: number;
    put_in: number;
    gain: number;
    gain_pct: number | null;
    scp: number;
    sj: number;
    children?: number;
    by_child?: { name: string; value: number }[];
    dividends_this_year: number;
    interest_this_year: number;
    estimated_accounts: number;
  };
  prices: { last_fetched: string | null; missing: string[] };
  allocation: { key: string; label: string; value: number; pct: number }[];
  accounts: InvestmentCard[];
}

export interface HoldingRow {
  symbol: string;
  name: string | null;
  asset_type: string;
  quantity: number;
  avg_cost: number;
  cost: number;
  price: number | null;
  price_date: string | null;
  price_source: string | null;
  value: number;
  gain: number;
  gain_pct: number | null;
  dividends_this_year: number;
}

export interface Holdings {
  category_id: number;
  name: string;
  owner: string;
  kind: AccountKind;
  holdings_entered: boolean;
  rows: HoldingRow[];
  cash: number;
  value: number | null;
  cost: number | null;
  gain: number | null;
  realized_this_year: number;
  dividends_this_year: number;
  tracking_since: string | null;
  activity: {
    id: number;
    date: string;
    side: 'buy' | 'sell';
    symbol: string;
    quantity: number;
    price: number;
    amount: number;
    fees: number;
    funding: string | null;
    transaction_id: number | null;
    notes: string | null;
  }[];
}

export interface InvestmentIncome {
  year: number;
  owner: 'SCP' | 'SJ' | null;
  months: { month: string; label: string; dividends: number; interest: number }[];
  by_account: {
    income_category_id: number;
    income_category: string;
    account: string;
    owner: string;
    kind: 'dividends' | 'interest';
    year_total: number;
    all_time: number;
  }[];
  by_symbol: { symbol: string | null; name: string | null; amount: number; owner?: 'SCP' | 'SJ' | 'Both' }[];
  totals: { dividends: number; interest: number; all_time_dividends: number; all_time_interest: number };
}

export interface DividendDetails {
  year: number;
  owner: 'SCP' | 'SJ' | null;
  months: { month: string; label: string; total: number; payments: number }[];
  rows: {
    transaction_id: number;
    date: string;
    month: string;
    symbol: string;
    account: string;
    owner: 'SCP' | 'SJ';
    amount: number;
    shares: number | null;
    per_share: number | null;
    approximate: boolean;
  }[];
  total: number;
  approximate_rows: number;
}

export interface AccountChoices {
  kinds: AccountKind[];
  unlinked_savings: { id: number; name: string; owner: string }[];
  income_categories: { id: number; name: string }[];
  debt_categories: { id: number; name: string }[];
}

export interface InvestmentAccountInput {
  category_id: number;
  kind: AccountKind;
  institution?: string;
  income_category_id?: number | null;
  debt_category_id?: number | null;
  beneficiary?: string | null;
}

export interface InvestmentOptions {
  accounts: {
    category_id: number;
    name: string;
    kind: AccountKind;
    owner: string;
    tracks_holdings: boolean;
    income_category_id: number | null;
    held: { symbol: string; name: string | null; quantity: number; avg_cost: number }[];
  }[];
  dividend_categories: { income_category_id: number; name: string; account_category_id: number; account: string }[];
  securities: { symbol: string; asset_type: string; name: string | null; quote_id: string | null }[];
}

@Injectable({ providedIn: 'root' })
export class InvestmentService {
  private readonly base = API_BASE_URL;

  constructor(private http: HttpClient) {}

  summary(): Observable<InvestmentSummary> {
    return this.http.get<InvestmentSummary>(this.base + 'investmentSummary');
  }

  holdings(categoryId: number): Observable<Holdings> {
    return this.http.post<Holdings>(this.base + 'holdings', { category_id: categoryId });
  }

  /** owner: '' for everyone, or 'SCP' / 'SJ'. */
  income(year: number, owner: '' | 'SCP' | 'SJ' = ''): Observable<InvestmentIncome> {
    return this.http.post<InvestmentIncome>(this.base + 'investmentIncome', { year, owner: owner || null });
  }

  dividendDetails(year: number, owner: '' | 'SCP' | 'SJ' = ''): Observable<DividendDetails> {
    return this.http.post<DividendDetails>(this.base + 'dividendDetails', { year, owner: owner || null });
  }

  accountChoices(): Observable<AccountChoices> {
    return this.http.get<AccountChoices>(this.base + 'investmentAccountChoices');
  }

  saveAccount(account: InvestmentAccountInput): Observable<{ category_id: number; kind: string }> {
    return this.http.post<any>(this.base + 'saveInvestmentAccount', { account });
  }

  options(): Observable<InvestmentOptions> {
    return this.http.get<InvestmentOptions>(this.base + 'investmentOptions');
  }

  saveTrade(trade: any): Observable<{ id: number; transaction_id: number | null; amount: number }> {
    return this.http.post<any>(this.base + 'saveTrade', { trade });
  }

  deleteTrade(id: number): Observable<any> {
    return this.http.post<any>(this.base + 'deleteTrade', { id });
  }

  saveDividend(transaction: any, symbol: string): Observable<any> {
    return this.http.post<any>(this.base + 'saveDividend', { transaction, symbol });
  }

  saveTransfer(transfer: {
    date: string;
    from_category_id: number;
    to_category_id: number | null;
    amount: number;
    note?: string;
  }): Observable<any> {
    return this.http.post<any>(this.base + 'saveTransfer', { transfer });
  }

  saveValuation(valuation: { category_id: number; date: string; value: number; note?: string }): Observable<any> {
    return this.http.post<any>(this.base + 'saveValuation', { valuation });
  }

  refreshPrices(force = false): Observable<{
    updated: string[];
    skipped_recent: string[];
    failed: { symbol: string; reason: string }[];
    as_of: string;
  }> {
    return this.http.post<any>(this.base + 'refreshPrices', { force });
  }

  savePrice(symbol: string, price: number): Observable<any> {
    return this.http.post<any>(this.base + 'savePrice', { symbol, price });
  }
}

/** Today (or a Date) as YYYY-MM-DD in local time, so it never lands on yesterday. */
export function localIso(d: Date = new Date()): string {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
