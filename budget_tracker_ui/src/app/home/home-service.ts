// FILE: src/app/home/home-service.ts  (REPLACE existing file)
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';

@Injectable({
  providedIn: 'root',
})
export class HomeService {
  BASE_URL: string = API_BASE_URL;

  constructor(private http: HttpClient) {}

  get_summary_chart(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'summaryChart', payload);
  }

  get_sub_chart(payload: any): Observable<any> {
    return this.http.post<any>(this.BASE_URL + 'subCharts', payload);
  }
}
