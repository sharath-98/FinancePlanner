// FILE: src/app/auth/auth.service.ts  (NEW file)
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, catchError, map, of, tap } from 'rxjs';
import { API_BASE_URL } from '../shared/app-config';
import { clearToken, setToken } from './auth-storage';

export interface AuthUser {
  id: number;
  username: string;
}

interface LoginResponse {
  token: string;
  expires_at: number;
  user: AuthUser;
}

interface MeResponse {
  auth_required: boolean;
  user?: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private userSubject = new BehaviorSubject<AuthUser | null>(null);
  private requiredSubject = new BehaviorSubject<boolean>(false);
  /** Set once the API has told us whether login is required (and who is signed in). */
  private checked = false;

  readonly user$ = this.userSubject.asObservable();
  readonly authRequired$ = this.requiredSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  get currentUser(): AuthUser | null {
    return this.userSubject.value;
  }

  login(username: string, password: string): Observable<AuthUser> {
    return this.http.post<LoginResponse>(API_BASE_URL + 'login', { username, password }).pipe(
      tap((res) => {
        setToken(res.token);
        this.userSubject.next(res.user);
        this.requiredSubject.next(true);
        this.checked = true;
      }),
      map((res) => res.user),
    );
  }

  logout(returnUrl?: string): void {
    clearToken();
    this.userSubject.next(null);
    this.checked = false;
    this.router.navigate(['/login'], returnUrl ? { queryParams: { returnUrl } } : undefined);
  }

  /**
   * True when the visitor may see the app pages. Asks the API (/me) once, so when login is
   * switched off on the API everyone is let in, and when it is on only a valid token is.
   */
  ensureSignedIn(): Observable<boolean> {
    if (this.checked) {
      return of(!this.requiredSubject.value || this.userSubject.value !== null);
    }
    return this.http.get<MeResponse>(API_BASE_URL + 'me').pipe(
      map((res) => {
        this.requiredSubject.next(res.auth_required);
        this.userSubject.next(res.auth_required ? (res.user ?? null) : null);
        this.checked = true;
        return true;
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) {
          clearToken();
          this.requiredSubject.next(true);
          this.userSubject.next(null);
          this.checked = true;
          return of(false);
        }
        // The API could not be reached: let the page open so it can show its own error message.
        return of(true);
      }),
    );
  }
}
