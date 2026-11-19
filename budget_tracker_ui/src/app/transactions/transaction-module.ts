// FILE: src/app/transactions/transaction-module.ts  (REPLACE existing file)
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../material-module';
import { AgGridModule } from 'ag-grid-angular';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { Transactions } from './transactions';
import { CategoryManagerDialog } from './category-manager-dialog';
import { ConfirmDialog } from './confirm-dialog';
import { EditTransactionDialog } from './edit-transaction-dialog';
import { EntryFinderDialog } from './entry-finder-dialog';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

@NgModule({
  declarations: [
    Transactions,
    CategoryManagerDialog,
    ConfirmDialog,
    EditTransactionDialog,
    EntryFinderDialog,
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    BrowserModule,
    AgGridModule,
    MaterialModule,
    FormsModule,
    ReactiveFormsModule,
  ],
})
export class TransactionModule {}
