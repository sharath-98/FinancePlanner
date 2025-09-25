
import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSelectModule } from '@angular/material/select';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

@NgModule({
  declarations: [],
  imports: [CommonModule],
  exports: [
    MatSlideToggleModule,
    MatDatepickerModule,
    MatCardModule,
    MatInputModule,
    MatFormFieldModule,
    MatExpansionModule,
    MatSelectModule,
    MatFormFieldModule,
    MatToolbarModule,
    MatIconModule,
    MatAutocompleteModule
  ],
})
export class MaterialModule {}
