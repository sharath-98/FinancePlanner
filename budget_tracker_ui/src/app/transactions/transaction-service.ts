// FILE: src/app/transactions/transaction-service.ts  (REPLACE existing file)
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

@Injectable({
  providedIn: 'root',
})
export class TransactionService {
  BASE_URL: string = API_BASE_URL;

  constructor(private http: HttpClient) {}

  get_categories(): Observable<any> {
    return this.http.get<any>(this.BASE_URL + 'categories');
  }

  get_users(): Observable<any> {
    return this.http.get<any>(this.BASE_URL + 'users');
  }

  get_yearly_transactions(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'transactions', payload);
  }

  get_subcategory(payload: any) {
    return this.http.post<any>(this.BASE_URL + 'getsubcategory', payload);
  }

  save_subcategory(payload: any) {
    return this.http.post<any>(this.BASE_URL + 'savesubcategory', payload);
  }

  save_expense(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'saveTransaction', payload);
  }
}
