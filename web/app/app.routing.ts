import { RouterModule, Routes } from "@angular/router";
import { HomeComponent } from "./home/home.component";
import { TenYearHomeComponent } from "./ten-year/ten-year-home/home.component";

const routes: Routes = [
    {path: "", component: HomeComponent},
    {
        path: "10year",
        //component: TenYearComponent,
        children: [
            {
                path: "",
                component: TenYearHomeComponent,
            },
        ],
    },
];

export const routing = RouterModule.forRoot(routes);
