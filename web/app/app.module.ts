import { NgModule } from "@angular/core";
import { AppComponent } from "./app.component";
import { BrowserModule } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";
import { routing } from "./app.routing";
import { TenYearHomeComponent } from "./ten-year/ten-year-home/home.component";
import { TenYearComponent } from "./ten-year/ten-year.component";
import { HomeComponent } from "./home/home.component";
import { HttpModule } from "@angular/http";

@NgModule({
    imports: [
        BrowserModule,
        HttpModule,
        FormsModule,
        routing,
        BrowserAnimationsModule,
    ],
    declarations: [
        AppComponent,
        HomeComponent,
        TenYearComponent,
        TenYearHomeComponent,

        // Vendor
    ],
    providers: [
        {provide: Window, useValue: window},

        // Vendor
    ],
    bootstrap: [AppComponent],
    entryComponents: []
})
export class AppModule {
}
