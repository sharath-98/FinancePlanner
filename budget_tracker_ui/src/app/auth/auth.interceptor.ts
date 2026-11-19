// FILE: src/app/auth/auth.interceptor.ts  (NEW file)
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';
import { getToken } from './auth-storage';
import { AuthService } from './auth.service';

/** Adds the login token to every request to the API, and signs out if the API says it expired. */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  // The Injector is used (instead of injecting AuthService directly) to avoid a circular dependency
  // with HttpClient, which AuthService itself needs.
  constructor(private injector: Injector) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = getToken();
    const isApiCall = req.url.startsWith(API_BASE_URL);
    const request =
      token && isApiCall ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        const isLoginOrCheck = req.url.endsWith('/login') || req.url.endsWith('/me');
        if (error.status === 401 && isApiCall && !isLoginOrCheck) {
          const router = this.injector.get(Router);
          this.injector.get(AuthService).logout(router.url);
        }
        return throwError(() => error);
      }),
    );
  }
}
