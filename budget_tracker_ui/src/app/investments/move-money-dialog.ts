// FILE: src/app/investments/move-money-dialog.ts  (NEW file)
// "Move money" (opened from the Transactions page): from one investment account to another,
// e.g. HYSA -> Stocks or HYSA -> Real Estate (down payment), or taken out to spend.
// A move is never new savings, so it does not touch the planner.
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { MaterialModule } from '../material-module';
import { InvestmentOptions, InvestmentService, localIso } from './investment-service';

const OUT = -1; // "Taken out to spend"

@Component({
  selector: 'app-move-money-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  template: `
    <h2 mat-dialog-title>Move money</h2>
    <form [formGroup]="form" (ngSubmit)="save()" novalidate>
      <mat-dialog-content>
        <p class="intro">Between your accounts (an HYSA to Stocks, or a down payment to Real Estate), or taken out to
          spend. It is not new savings, so the Budget planning page does not change. For buying shares, use the
          Buy panel instead.</p>
        <div class="fields">
          <mat-form-field appearance="outline">
            <mat-label>From</mat-label>
            <mat-select formControlName="from">
              <mat-option *ngFor="let a of accounts" [value]="a.category_id">{{ a.name }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>To</mat-label>
            <mat-select formControlName="to">
              <mat-option *ngFor="let a of accounts" [value]="a.category_id" [disabled]="a.category_id === form.value.from">{{ a.name }}</mat-option>
              <mat-option [value]="OUT">Taken out to spend</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Amount</mat-label>
            <span matTextPrefix>$&nbsp;</span>
            <input matInput type="number" step="0.01" min="0.01" formControlName="amount" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput type="date" [max]="today" formControlName="date" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="wide">
            <mat-label>Note (optional)</mat-label>
            <input matInput formControlName="note" maxlength="255" placeholder="e.g. Down payment" autocomplete="off" />
          </mat-form-field>
        </div>
        <p class="error" role="alert" aria-live="polite">{{ errorText }}</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button type="button" class="btn btn-secondary" (click)="ref.close(false)">Cancel</button>
        <button type="submit" class="btn" [disabled]="saving">{{ saving ? 'Saving…' : 'Move' }}</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [
    `
      .intro { margin: 0 0 var(--space-3); color: var(--text-muted); font-size: var(--fs-sm); line-height: 1.45; }
      .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2) var(--space-3); padding-top: var(--space-2); }
      .wide { grid-column: 1 / -1; }
      .error { min-height: 1.25em; margin: var(--space-2) 0 0; color: var(--negative); font-size: var(--fs-sm); }
      @media (max-width: 520px) { .fields { grid-template-columns: 1fr; } }
    `,
  ],
})
export class MoveMoneyDialog implements OnInit {
  private fb = inject(FormBuilder);
  readonly OUT = OUT;
  readonly today = localIso();
  accounts: InvestmentOptions['accounts'] = [];
  saving = false;
  errorText = '';

  form = this.fb.group({
    from: [null as number | null, Validators.required],
    to: [null as number | null, Validators.required],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]],
    date: [localIso(), Validators.required],
    note: ['', Validators.maxLength(255)],
  });

  constructor(
    private invest: InvestmentService,
    private toastr: ToastrService,
    public ref: MatDialogRef<MoveMoneyDialog, boolean>,
  ) {}

  ngOnInit(): void {
    this.invest.options().subscribe({
      next: (o) => (this.accounts = o.accounts),
      error: () => (this.errorText = 'Could not load your accounts.'),
    });
  }

  save(): void {
    if (this.saving) return;
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (this.form.invalid || v.from == null || v.to == null || !v.date) {
      this.errorText = 'Choose both accounts, the amount and the date.';
      return;
    }
    if (v.from === v.to) {
      this.errorText = 'Pick two different accounts.';
      return;
    }
    if (v.date > this.today) {
      this.errorText = 'The date cannot be in the future.';
      return;
    }
    this.saving = true;
    this.errorText = '';
    this.invest
      .saveTransfer({
        date: v.date,
        from_category_id: v.from,
        to_category_id: v.to === OUT ? null : v.to,
        amount: Number(v.amount),
        note: (v.note ?? '').trim(),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.toastr.success('Money moved.');
          this.ref.close(true);
        },
        error: (err: HttpErrorResponse) => {
          this.saving = false;
          this.errorText = err.status === 0 ? 'Cannot reach the server.' : err.error?.error ?? 'Could not save.';
        },
      });
  }
}
