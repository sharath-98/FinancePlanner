// FILE: src/app/transactions/confirm-dialog.ts  (NEW file)
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';

export interface ConfirmDialogData {
  title: string;
  message: string;
  /** Extra lines shown under the message (what will change). */
  details?: string[];
  confirmLabel: string;
  /** Red confirm button, for things that cannot be undone. */
  danger?: boolean;
}

/** A small "are you sure?" box. Closes with true when confirmed, false when cancelled. */
@Component({
  selector: 'app-confirm-dialog',
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.css',
  standalone: false,
})
export class ConfirmDialog {
  constructor(@Inject(MAT_DIALOG_DATA) public data: ConfirmDialogData) {}
}
