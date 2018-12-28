import * as Promise from "bluebird";
import { RequestResponse } from "request";
import { AmpProduct, AmpProductCategory, AmpUser } from "./responses";
import { LogService } from "matrix-js-snippets";
import { AMemberConfig } from "../plugin/impl/AMemberPlugin";
import request = require("request");

export class AMemberProApi {


    constructor(private config: AMemberConfig) {
    }

    public getUsers(page = 0, count = 1000): Promise<AmpUser[]> {
        return this.authedRequest("GET", "/api/users", {
            _nested: ["invoices", "access"],
            _page: page,
            _count: count
        }).then(this.deObjectify);
    }

    public getProducts(page = 0, count = 1000): Promise<AmpProduct[]> {
        return this.authedRequest("GET", "/api/products", {
            _nested: ["product-product-category"],
            _page: page,
            _count: count
        }).then(this.deObjectify);
    }

    public getProductCategories(page = 0, count = 1000): Promise<AmpProductCategory[]> {
        return this.authedRequest("GET", "/api/product-category", {
            _page: page,
            _count: count
        }).then(this.deObjectify);
    }

    private deObjectify(response: any): any[] {
        const keys = Object.keys(response).filter(k => k !== "_total");
        return keys.map(k => response[k]);
    }

    private authedRequest<T>(method: string, endpoint: string, qs: any): Promise<T> {
        let baseUrl = this.config.url;
        if (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length - 1);
        if (!endpoint.startsWith("/")) endpoint = `/${endpoint}`;
        const url = baseUrl + endpoint;
        LogService.verbose("AMemberProApi", `Doing web request ${method} ${url}`);
        if (!qs) qs = {};
        qs["_key"] = this.config.apiKey;
        return new Promise<T>((resolve, reject) => {
            request({
                method: method,
                url: url,
                qs: qs,
            }, (error: any, response: RequestResponse, body: any) => {
                if (error) {
                    reject(error);
                    return;
                }

                if (typeof(response.body) === 'string') {
                    response.body = JSON.parse(response.body);
                }

                resolve(response.body);
            });
        });
    }
}