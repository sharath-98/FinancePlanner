// FILE: src/app/auth/auth-module.ts  (NEW file)
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MaterialModule } from '../material-module';
import { Login } from './login';

@NgModule({
  declarations: [Login],
  imports: [CommonModule, ReactiveFormsModule, MaterialModule],
  exports: [Login],
})
export class AuthModule {}
