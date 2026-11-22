// FILE: src/app/debt/debt-service.ts  (NEW file)
// Calls the Phase 5 debt endpoints. The auth interceptor adds the token as for every other call.
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

export interface PaidSplit {
  paid: number;
  principal: number;
  interest: number;
}

export interface Projection {
  monthly_payment: number | null;
  lump_sum: number;
  paying_off: boolean;
  months: number | null;
  payoff_month: string | null; // "2027-03"
  payoff_label?: string; // "Mar-2027"
  interest_remaining: number | null;
  total_remaining: number | null;
  reason?: string;
}

export interface DebtLoan {
  category_id: number;
  category: string;
  status: 'active' | 'paid_off' | 'setup_needed';
  setup_needed: boolean;
  paid: { all_time: number; this_year: number; payments: number };
  last_payment: { date: string; amount: number; merchant: string } | null;
  scheduled: { count: number; total: number; next_date: string | null };
  // Present once the loan is set up:
  account_id?: number;
  lender?: string | null;
  interest_rate?: number;
  as_of?: string;
  balance?: number;
  principal_balance?: number;
  accrued_interest?: number;
  balance_source?: 'estimated' | 'statement';
  opening?: { date: string; balance: number };
  original_amount?: number | null;
  progress_pct?: number | null;
  progress_basis?: 'original_amount' | 'opening_balance';
  since_opening?: PaidSplit;
  this_year_split?: PaidSplit;
  last_statement?: { date: string; balance: number; correction: number } | null;
  payment_used?: { amount: number | null; source: 'account' | 'recent_payments' | null };
  projection?: Projection;
}

export interface DebtSummary {
  as_of: string;
  totals: {
    balance: number;
    paid_this_year: number;
    principal_this_year: number;
    interest_this_year: number;
    debt_free_month: string | null;
    loans_active: number;
    loans_setup_needed: number;
  };
  loans: DebtLoan[];
}

export interface DebtHistoryMonth {
  month: string;
  label: string;
  paid: number;
  payments: number;
  principal: number | null;
  interest: number | null;
  balance_end: number | null;
  statement: { date: string; balance: number; correction: number } | null;
}

export interface DebtAccountInput {
  category_id: number;
  opening_balance: number;
  opening_balance_date: string; // "2025-12-31"
  interest_rate: number; // APR %, e.g. 4.99
  lender?: string;
  monthly_payment?: number | null;
  original_amount?: number | null;
  start_date?: string | null;
  term_months?: number | null;
  closed_date?: string | null;
  notes?: string;
}

@Injectable({ providedIn: 'root' })
export class DebtService {
  private readonly base = API_BASE_URL;

  constructor(private http: HttpClient) {}

  summary(): Observable<DebtSummary> {
    return this.http.get<DebtSummary>(this.base + 'debtSummary');
  }

  history(categoryId: number): Observable<{ category_id: number; category: string; setup_needed: boolean; months: DebtHistoryMonth[] }> {
    return this.http.post<any>(this.base + 'debtHistory', { category_id: categoryId });
  }

  scenario(categoryId: number, extraMonthly = 0, lumpSum = 0): Observable<any> {
    return this.http.post<any>(this.base + 'debtPayoffScenario', {
      category_id: categoryId,
      extra_monthly: extraMonthly,
      lump_sum: lumpSum,
    });
  }

  accounts(): Observable<any[]> {
    return this.http.get<any[]>(this.base + 'debtAccounts');
  }

  /** Creates a new debt category (uses the existing /saveCategory route). */
  saveDebtCategory(name: string): Observable<{ id: number; name: string; type: string }> {
    return this.http.post<{ id: number; name: string; type: string }>(this.base + 'saveCategory', {
      name,
      type: 'debt',
    });
  }

  saveAccount(account: DebtAccountInput): Observable<{ id: number; category_id: number }> {
    return this.http.post<any>(this.base + 'saveDebtAccount', { account });
  }

  saveStatementBalance(categoryId: number, date: string, balance: number, note = ''): Observable<any> {
    return this.http.post<any>(this.base + 'saveDebtBalance', { category_id: categoryId, date, balance, note });
  }
}
