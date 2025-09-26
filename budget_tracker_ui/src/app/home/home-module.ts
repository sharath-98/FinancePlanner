import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgCharts, AgChartsModule } from 'ag-charts-angular';
import { AgGridModule } from 'ag-grid-angular';
import { Home } from './home';
import { MaterialModule } from '../material-module';
import { MatMomentDateModule } from '@angular/material-moment-adapter';
import { ReactiveFormsModule } from '@angular/forms';

@NgModule({
  declarations: [Home],
  imports: [
    CommonModule,
    AgGridModule,
    AgCharts,
    AgChartsModule,
    MaterialModule,
    MatMomentDateModule,
    ReactiveFormsModule
  ],
})
export class HomeModule {}
