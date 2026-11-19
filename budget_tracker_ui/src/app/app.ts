// FILE: src/app/app.ts  (REPLACE existing file)
import { Component, Inject, OnInit } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { SpinnerService } from './services/spinner-service';
import { NavigationEnd, Router } from '@angular/router';
import { Observable, filter } from 'rxjs';
import { AuthService, AuthUser } from './auth/auth.service';

type Theme = 'light' | 'dark';
const THEME_KEY = 'ledger-theme';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
})
export class App implements OnInit {
  loading$: Observable<boolean>;
  isDark = false;
  /** The login page has no menu, so the header is hidden there. */
  onLoginPage = false;
  user$: Observable<AuthUser | null>;

  constructor(
    private loadingService: SpinnerService,
    private auth: AuthService,
    private router: Router,
    @Inject(DOCUMENT) private document: Document,
  ) {
    this.loading$ = this.loadingService.loading$;
    this.user$ = this.auth.user$;
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => (this.onLoginPage = event.urlAfterRedirects.startsWith('/login')));
  }

  signOut(): void {
    this.auth.logout();
  }

  ngOnInit(): void {
    this.applyTheme(this.initialTheme());
  }

  toggleTheme(): void {
    this.applyTheme(this.isDark ? 'light' : 'dark');
  }

  private initialTheme(): Theme {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // storage can be unavailable (private mode); fall through to system preference
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private applyTheme(theme: Theme): void {
    this.isDark = theme === 'dark';
    this.document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }
}
