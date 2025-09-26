import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { MatDatepicker } from '@angular/material/datepicker';
import { AgCharts } from 'ag-charts-angular';
import { AgChartOptions } from 'ag-charts-community';
import * as _moment from 'moment';
import { Moment } from 'moment';
import { HomeService } from './home-service';

@Component({
  selector: 'app-home',
  standalone: false,
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home implements OnInit {
  range = new FormGroup({
    start: new FormControl<Date | null>(new Date()),
    end: new FormControl<Date | null>(new Date()),
  });

  public summaryChartOptions: AgChartOptions;
  public incomeChartOptions: AgChartOptions;
  public savingsChartOptions: AgChartOptions;
  public expenseChartOptions: AgChartOptions;

  summaryChartData: any;

  constructor(private homeSrv: HomeService) {
    this.summaryChartOptions = {
      title: {
        text: 'Income vs Expenditure (Tracked)',
      },
      data: this.summaryChartData,
      series: [
        {
          type: 'line',
          xKey: 'month',
          yKey: 'income',
          yName: 'Income',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'expense',
          yName: 'Expense',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'debt',
          yName: 'Debt',
        },
        {
          type: 'line',
          xKey: 'month',
          yKey: 'savings',
          yName: 'Savings',
        },
      ],

      width: 1100, // Fixed width in pixels
      height: 380,
    };

    this.incomeChartOptions = {
      title: {
        text: 'Income (Tracked)',
      },
      data: [],
      series: [
        {
          type: 'donut',
          calloutLabelKey: 'category',
          angleKey: 'amount',
        },
      ],
      width: 373,
      height: 360,
    };

    this.savingsChartOptions = {
      // Series: Defines which chart type and data to use
      title: {
        text: 'Savings (Tracked)',
      },
      data: [],
      series: [
        {
          type: 'donut',
          calloutLabelKey: 'category',
          angleKey: 'amount',
        },
      ],
      width: 373, // Fixed width in pixels
      height: 360,
    };

    this.expenseChartOptions = {
      title: {
        text: 'Expenses (Tracked)',
      },
      data: [],
      series: [
        {
          type: 'donut',
          calloutLabelKey: 'category',
          angleKey: 'amount',
        },
      ],
      width: 373, // Fixed width in pixels
      height: 360,
    };
  }

  ngOnInit(): void {
    this.onDatePickerClosed();
  }

  onDatePickerClosed() {
    let payload = {
      start: this.range.value.start?.toISOString(),
      end: this.range.value.end?.toISOString(),
    };

    this.homeSrv.get_summary_chart(payload).subscribe((data) => {
      this.summaryChartOptions = {
        ...this.summaryChartOptions,
        data: data,
      };
    });

    this.homeSrv.get_sub_chart(payload).subscribe((data) => {
      this.incomeChartOptions = {
        ...this.incomeChartOptions,
        data: data['income'],
      };

      this.savingsChartOptions = {
        ...this.savingsChartOptions,
        data: data['savings'],
      };

      this.expenseChartOptions = {
        ...this.expenseChartOptions,
        data: data['expense'],
      };
    });
  }
}
