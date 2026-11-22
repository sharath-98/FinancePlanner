// FILE: src/app/debt/debt-module.ts  (NEW file)
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { AgCharts } from 'ag-charts-angular';
import { MaterialModule } from '../material-module';
import { Debt } from './debt';
import { LoanSetupDialog } from './loan-setup-dialog';

@NgModule({
  declarations: [Debt, LoanSetupDialog],
  imports: [CommonModule, ReactiveFormsModule, AgCharts, MaterialModule],
})
export class DebtModule {}
