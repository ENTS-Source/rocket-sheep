import * as Promise from "bluebird";
import { RequestResponse } from "request";
import { LogService } from "matrix-js-snippets";
import request = require("request");

const MAX_DATAPOINTS = 2999; // It's actually 3000

export class EmoncmsFeedApi {

    constructor(private baseUrl: string, private apiKey: string) {
    }

    public getDailyDatapoints(feedId: string, start: number, end: number): Promise<any[][]> {
        return this.doDatapointsRequest({
            mode: "daily",
            start: start,
            end: end,
            id: feedId,
            apikey: this.apiKey,
        });
    }

    public getDatapoints(feedId: string, start: number, end: number, interval: number): Promise<any[][]> {
        let datapoints = ((end - start) / 1000) / interval;

        const requestPairs = [];
        let lastStart = start;
        do {
            const newEnd = Math.min(end, lastStart + ((interval * MAX_DATAPOINTS) * 1000));
            datapoints -= ((newEnd - lastStart) / 1000) / interval;
            requestPairs.push([lastStart, newEnd]);
            lastStart = newEnd + 1;
        } while (datapoints > 0);

        return Promise.all(requestPairs.map(p => {
            const rqStart = p[0];
            const rqEnd = p[1];

            const qs = {
                id: feedId,
                start: rqStart,
                end: rqEnd,
                apikey: this.apiKey,
                interval: interval,
            };

            return this.doDatapointsRequest(qs);
        })).then((results: any[][]) => {
            const flatResults = [];
            for (const result of results) {
                for (const dp of result) {
                    flatResults.push(dp);
                }
            }
            return flatResults;
        });
    }

    private doDatapointsRequest(qs: any): Promise<any[][]> {
        return new Promise(((resolve, reject) => {
            request.get(this.baseUrl + "/feed/data.json", {
                qs: qs,
                encoding: null,
            }, (error: any, response: RequestResponse, body: any) => {
                if (error) {
                    reject(error);
                    return;
                }

                LogService.verbose("EmoncmsFeedApi", "Response length: " + body.length);

                if (typeof(body) === "string") {
                    body = JSON.parse(body);
                } else if (Buffer.isBuffer(body)) {
                    body = JSON.parse(body.toString('utf8'));
                }


                LogService.verbose("EmoncmsFeedApi", body);
                if (body["success"] === false) {
                    reject(body);
                    return;
                }

                resolve(body);
            });
        }));
    }
}