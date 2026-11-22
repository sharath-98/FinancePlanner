// FILE: src/app/debt/loan-setup-dialog.ts  (NEW file)
// One dialog for three jobs:
//   * add a new loan (creates a debt category, then its loan details)
//   * set up or edit the details of an existing debt category
//   * record a balance from a lender statement or app
import { HttpErrorResponse } from '@angular/common/http';
import { Component, Inject, inject } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { Observable, map, of, switchMap } from 'rxjs';
import { DebtAccountInput, DebtService } from './debt-service';

export interface LoanSetupData {
  mode: 'account' | 'balance';
  /** Missing when adding a brand-new loan. */
  categoryId?: number;
  categoryName?: string;
  /** Saved details from GET /debtAccounts, when the loan is already set up. */
  account?: any | null;
}

/** Today as YYYY-MM-DD in local time (not UTC, so it never lands on yesterday). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-loan-setup-dialog',
  templateUrl: './loan-setup-dialog.html',
  styleUrl: './loan-setup-dialog.css',
  standalone: false,
})
export class LoanSetupDialog {
  private fb = inject(FormBuilder);
  readonly isNew: boolean;
  readonly today = todayIso();
  saving = false;
  errorText = '';

  form = this.fb.group({
    name: ['', [Validators.maxLength(100)]],
    lender: ['', [Validators.maxLength(200)]],
    startFrom: ['start' as 'start' | 'balance'],
    original_amount: [null as number | null],
    start_date: [''],
    opening_balance: [null as number | null],
    opening_balance_date: [''],
    interest_rate: [null as number | null, [Validators.required, Validators.min(0), Validators.max(99.999)]],
    monthly_payment: [null as number | null, [Validators.min(0.01)]],
    term_months: [null as number | null, [Validators.min(1), Validators.max(600)]],
    paid_off: [false],
    closed_date: [''],
    notes: ['', [Validators.maxLength(255)]],
  });

  balanceForm = this.fb.group({
    date: [todayIso(), Validators.required],
    balance: [null as number | null, [Validators.required, Validators.min(0)]],
    note: ['', [Validators.maxLength(255)]],
  });

  constructor(
    private debtSrv: DebtService,
    private toastr: ToastrService,
    private dialogRef: MatDialogRef<LoanSetupDialog, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: LoanSetupData,
  ) {
    this.isNew = data.mode === 'account' && !data.categoryId;
    if (this.isNew) {
      this.form.controls.name.addValidators(Validators.required);
    }
    const a = data.account;
    if (a) {
      const fromStart =
        a.original_amount != null &&
        a.start_date != null &&
        a.original_amount === a.opening_balance &&
        a.start_date === a.opening_balance_date;
      this.form.patchValue({
        lender: a.lender ?? '',
        startFrom: fromStart ? 'start' : 'balance',
        original_amount: a.original_amount,
        start_date: a.start_date ?? '',
        opening_balance: a.opening_balance,
        opening_balance_date: a.opening_balance_date ?? '',
        interest_rate: a.interest_rate,
        monthly_payment: a.monthly_payment,
        term_months: a.term_months,
        paid_off: !!a.closed_date,
        closed_date: a.closed_date ?? '',
        notes: a.notes ?? '',
      });
    }
  }

  get title(): string {
    if (this.data.mode === 'balance') return `Update balance: ${this.data.categoryName}`;
    if (this.isNew) return 'Add a loan';
    return `${this.data.account ? 'Edit' : 'Set up'} ${this.data.categoryName}`;
  }

  get fromStart(): boolean {
    return this.form.controls.startFrom.value === 'start';
  }

  // ---------- Loan details ----------

  saveAccount(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    const problem = this.checkAccount(v);
    if (problem || this.form.invalid) {
      this.errorText = problem ?? 'Check the highlighted fields.';
      return;
    }

    const account: Omit<DebtAccountInput, 'category_id'> = {
      lender: (v.lender ?? '').trim(),
      interest_rate: Number(v.interest_rate),
      monthly_payment: v.monthly_payment ?? null,
      term_months: v.term_months ?? null,
      original_amount: v.original_amount ?? null,
      start_date: v.start_date || null,
      opening_balance: Number(this.fromStart ? v.original_amount : v.opening_balance),
      opening_balance_date: (this.fromStart ? v.start_date : v.opening_balance_date) as string,
      closed_date: v.paid_off ? v.closed_date || null : null,
      notes: (v.notes ?? '').trim(),
    };

    // A new loan needs its debt category first; then the details are saved against it.
    const categoryId$: Observable<number> = this.isNew
      ? this.debtSrv.saveDebtCategory((v.name ?? '').trim()).pipe(map((created) => created.id))
      : of(this.data.categoryId!);

    this.saving = true;
    this.errorText = '';
    categoryId$
      .pipe(switchMap((categoryId) => this.debtSrv.saveAccount({ category_id: categoryId, ...account })))
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success(this.isNew ? 'Loan added.' : 'Loan details saved.');
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => this.fail(error, 'Could not save the loan.'),
      });
  }

  /** Checks that depend on which fields are in use. Returns a message, or null when fine. */
  private checkAccount(v: ReturnType<LoanSetupDialog['form']['getRawValue']>): string | null {
    if (this.isNew && !(v.name ?? '').trim()) return 'Give the loan a name, e.g. Housing-Loan.';
    if (this.fromStart) {
      if (!v.original_amount || v.original_amount <= 0) return 'Enter the amount borrowed.';
      if (!v.start_date) return 'Enter the date the loan started.';
      if (v.start_date > this.today) return 'The start date cannot be in the future.';
    } else {
      if (v.opening_balance == null || v.opening_balance < 0) return 'Enter the balance owed.';
      if (!v.opening_balance_date) return 'Enter the date of that balance.';
      if (v.opening_balance_date > this.today) return 'The balance date cannot be in the future.';
    }
    if (v.interest_rate == null) return 'Enter the interest rate (APR). Use 0 if there is none.';
    if (v.paid_off && !v.closed_date) return 'Enter the date the loan was paid off.';
    return null;
  }

  // ---------- Balance from the lender ----------

  saveBalance(): void {
    if (this.saving) return;
    this.balanceForm.markAllAsTouched();
    const v = this.balanceForm.getRawValue();
    if (this.balanceForm.invalid || !v.date) {
      this.errorText = 'Enter the balance and its date.';
      return;
    }
    if (v.date > this.today) {
      this.errorText = 'The date cannot be in the future.';
      return;
    }
    this.saving = true;
    this.errorText = '';
    this.debtSrv
      .saveStatementBalance(this.data.categoryId!, v.date, Number(v.balance), (v.note ?? '').trim())
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success('Balance saved.');
          this.dialogRef.close(true);
        },
        error: (error: HttpErrorResponse) => this.fail(error, 'Could not save the balance.'),
      });
  }

  private fail(error: HttpErrorResponse, fallback: string): void {
    this.saving = false;
    this.errorText =
      error.status === 0
        ? 'Cannot reach the server. Check that the API is running.'
        : (error.error?.error ?? fallback);
  }

  close(): void {
    this.dialogRef.close(false);
  }
}
