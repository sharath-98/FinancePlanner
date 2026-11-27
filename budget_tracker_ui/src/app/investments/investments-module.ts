// FILE: src/app/investments/investments-module.ts  (NEW file)
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { AgCharts } from 'ag-charts-angular';
import { MaterialModule } from '../material-module';
import { Investments } from './investments';

@NgModule({
  declarations: [Investments],
  imports: [CommonModule, AgCharts, MaterialModule, MatMenuModule],
})
export class InvestmentsModule {}
