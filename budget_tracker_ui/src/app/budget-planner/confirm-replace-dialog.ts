// FILE: src/app/budget-planner/confirm-replace-dialog.ts  (NEW file)
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { formatUsd, formatUsdExact } from '../shared/design-tokens';

export interface ConfirmReplaceData {
  category: string;
  month: string;
  year: number;
  transactionCount: number;
  transactionTotal: number;
  plannerAmount: number;
  newAmount: number;
}

@Component({
  selector: 'app-confirm-replace-dialog',
  templateUrl: './confirm-replace-dialog.html',
  styleUrl: './confirm-replace-dialog.css',
  standalone: false,
})
export class ConfirmReplaceDialog {
  usd = formatUsd;
  usdExact = formatUsdExact;

  constructor(@Inject(MAT_DIALOG_DATA) public data: ConfirmReplaceData) {}

  /** What will be recorded as the adjustment (new planner number minus what it held). */
  get difference(): number {
    return Math.round((this.data.newAmount - this.data.plannerAmount) * 100) / 100;
  }
}
