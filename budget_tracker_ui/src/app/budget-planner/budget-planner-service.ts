import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BudgetPlannerService {

  BASE_URL: string = "http://127.0.0.1:5000/"

  constructor(private http: HttpClient) { }

  get_monthly_income(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + "income", payload);
  }

  get_monthly_expenses(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + "expenses", payload);
  }

  get_monthly_savings(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + "savings", payload);
  }

  get_monthly_debts(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + "debt", payload);
  }
}
