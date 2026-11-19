// FILE: src/app/auth/auth.guard.ts  (NEW file)
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

/** Sends visitors who are not signed in to the login page (when the API requires login). */
export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return inject(AuthService)
    .ensureSignedIn()
    .pipe(
      map((allowed) =>
        allowed
          ? true
          : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } }),
      ),
    );
};
