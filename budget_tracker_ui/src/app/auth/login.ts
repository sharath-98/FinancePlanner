// FILE: src/app/auth/login.ts  (NEW file)
import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.css',
  standalone: false,
})
export class Login {
  form: FormGroup<{ username: FormControl<string | null>; password: FormControl<string | null> }>;
  submitting = false;
  errorMessage = '';
  showPassword = false;

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
  ) {
    this.form = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });
  }

  submit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.errorMessage = '';
    const { username, password } = this.form.getRawValue();

    this.auth.login(username!.trim(), password!).subscribe({
      next: () => this.router.navigateByUrl(this.safeReturnUrl()),
      error: (error: HttpErrorResponse) => {
        this.submitting = false;
        this.form.controls.password.reset('');
        this.errorMessage =
          error.status === 0
            ? 'Cannot reach the server. Check that the API is running.'
            : (error.error?.error ?? 'Could not sign in. Please try again.');
      },
    });
  }

  /** Only paths inside this app are accepted as the page to go back to. */
  private safeReturnUrl(): string {
    const target = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    return target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/login')
      ? target
      : '/home';
  }
}
