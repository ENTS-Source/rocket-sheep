import { Plugin } from "../Plugin";
import { LogService } from "matrix-js-snippets";
import { CommandHandler } from "../../matrix/CommandHandler";
import { AMemberProApi } from "../../amemberpro/AMemberProApi";
import * as path from "path";
import * as fs from "fs";
import * as stringTemplate from "string-template";
import * as wkhtmltopdf from "wkhtmltopdf";
import * as streamToArray from "stream-to-array";
import Webserver from "../../api/Webserver";
import moment = require("moment");

/**
 * Plugin for querying information about the membership (from aMember Pro)
 */
export class AMemberPlugin implements Plugin {

    private ampApi: AMemberProApi;

    /**
     * Creates a new aMember Pro plugin
     * @param config the config to use
     * @param admins the admins for the bot
     * @param webPort the web server listening port
     */
    constructor(private config: AMemberConfig, private admins: string[], private webPort: number) {
        this.ampApi = new AMemberProApi(config);
    }

    public init(): void {
        LogService.info("AMemberPlugin", "Registering command handler");
        CommandHandler.registerCommand("!report members", this.membersCommand.bind(this), "!report members - Generates a membership composition report");
    }

    private async membersCommand(_cmd: string, _args: string[], roomId: string, sender: string, matrixClient: any) {
        if (this.admins.indexOf(sender) === -1) {
            matrixClient.sendNotice(roomId, "You do not have the required permissions to run this command.");
            return;
        }

        LogService.verbose("AMemberPlugin", "Generating membership composition report for " + roomId);
        matrixClient.sendNotice(roomId, "Generating membership report...");
        const users = await this.ampApi.getUsers();
        const products = await this.ampApi.getProducts();
        const categories = await this.ampApi.getProductCategories();

        const allInterestedCategories = [this.config.activeMemberCategory, ...this.config.interestedCategories];

        // We're interested in the last 6 months of data, so track that
        const dataByMonth: { [relMonth: number]: { categories: { [category: string]: number }, total: number, expired: number } } = {
            0: {categories: {}, total: 0, expired: 0},
            1: {categories: {}, total: 0, expired: 0},
            2: {categories: {}, total: 0, expired: 0},
            3: {categories: {}, total: 0, expired: 0},
            4: {categories: {}, total: 0, expired: 0},
            5: {categories: {}, total: 0, expired: 0},
            6: {categories: {}, total: 0, expired: 0},
        };

        let dataBuckets = Object.keys(dataByMonth).map(b => Number(b));
        const earliestDate = moment().endOf('month');

        for (const user of users) {
            const accessMap: { [relMonth: number]: { [category: string]: boolean } } = {};

            // We also track 1 additional month of data for diff purposes
            const userDataBuckets = [...dataBuckets, Math.max(...dataBuckets) + 1];
            for (const relMonth of userDataBuckets) accessMap[relMonth] = {};


            if (!user.nested) user.nested = {access: [], invoices: []};
            if (!user.nested.access) user.nested.access = [];
            for (const access of user.nested.access) {
                const product = products.find(p => p.product_id === Number(access.product_id) && !!p.nested && !!p.nested["product-product-category"]);
                if (!product) continue;
                const productCategories = product.nested["product-product-category"].map(c => categories.find(c2 => Number(c.product_category_id) === c2.product_category_id))
                    .filter(c => c).filter(c => allInterestedCategories.indexOf(c.title) !== -1).map(c => c.title);
                if (!productCategories) continue;

                const beginDate = moment(access.begin_date).startOf('month');
                const endDate = moment(access.expire_date).endOf('month');
                for (let m = moment(beginDate); m.isBefore(endDate); m.add(1, 'months')) {
                    const relativeMonths = earliestDate.diff(m, 'months');
                    if (userDataBuckets.indexOf(relativeMonths) === -1) continue;

                    for (const category of productCategories) {
                        if (!accessMap[relativeMonths]) accessMap[relativeMonths] = {};
                        if (!accessMap[relativeMonths][category]) accessMap[relativeMonths][category] = true;
                        accessMap[relativeMonths][category] = true;
                    }
                }
            }

            const signupDate = moment(user.added.split(' ')[0]);
            const signupMonthsAgo = earliestDate.diff(signupDate.startOf('month'), 'months');

            for (let i = 0; i < dataBuckets.length; i++) {
                const relMonth = dataBuckets[i];
                const map = accessMap[relMonth];
                const dataMap = dataByMonth[relMonth];
                let hasCategory = false;
                for (const category of Object.keys(map)) {
                    if (!dataMap.categories[category]) dataMap.categories[category] = 0;
                    if (!map[category]) continue;
                    dataMap.categories[category]++;
                    hasCategory = true;
                }
                if (signupMonthsAgo >= relMonth) dataMap.total++;
                if (!hasCategory && i > 0 && i < userDataBuckets.length - 1) {
                    const lastMonth = accessMap[userDataBuckets[i - 1]];
                    if (lastMonth && Object.keys(lastMonth).length) dataMap.expired++;
                }
            }
        }

        dataBuckets = dataBuckets.reverse();
        const numActiveDiff = dataByMonth[0].categories[this.config.activeMemberCategory] - dataByMonth[1].categories[this.config.activeMemberCategory];
        const compositionOverTimeData = {}; // label => count[]
        for (const label of this.config.interestedCategories) {
            compositionOverTimeData[label] = dataBuckets.map(b => dataByMonth[b].categories[label]);
        }
        const dateLabels = `'${dataBuckets.map(b => moment().startOf('month').add(-b, 'months').format('MMM YYYY')).join("','")}'`;

        let html = fs.readFileSync(path.join('report_templates', 'members.html'), {encoding: 'utf8'});
        html = stringTemplate(html, {
            fromDate: moment().startOf('month').add(-Math.max(...dataBuckets), 'months').format('MMM DD, YYYY'),
            toDate: moment().endOf('month').format('MMM DD, YYYY'),
            numActiveMembers: dataByMonth[0].categories[this.config.activeMemberCategory],
            numTotalMembers: dataByMonth[0].total,
            numActiveDiff: numActiveDiff < 0 ? '-' : (numActiveDiff > 0 ? '+' : '') + numActiveDiff,
            numActiveDiffDirection: numActiveDiff < 0 ? 'negative' : (numActiveDiff > 0 ? 'positive' : 'unchanged'),
            generatedDate: moment().format('MMM DD, YYYY'),
            changeOverTimeLabels: dateLabels,
            activeMembersOverTimeData: dataBuckets.map(b => dataByMonth[b].categories[this.config.activeMemberCategory]).join(','),
            expiredMembersOverTimeData: dataBuckets.filter(b => b > 0).map(b => dataByMonth[b].expired).join(','),
            compositionOverTimeData: JSON.stringify(compositionOverTimeData),
            compositionOverTimeLabels: dateLabels,
        });

        const reportId = `${moment().format('MMMMDDYYYY')}${(new Date()).getTime()}`;
        Webserver.CACHED_REPORTS[reportId] = html;

        LogService.info("AMemberPlugin", "Generating PDF...");
        wkhtmltopdf(`http://localhost:${this.webPort}/reports/${reportId}`, {
            marginLeft: 0,
            marginRight: 0,
            marginTop: 0,
            marginBottom: 0,
            javascriptDelay: 1000,
            pageSize: "letter",
        }, async (err, stream) => {
            delete Webserver.CACHED_REPORTS[reportId];
            if (err) {
                console.error(err);
                matrixClient.sendNotice(roomId, "Error generating report");
                return;
            }

            try {
                const rawData = await streamToArray(stream);
                const data = [];
                for (const part of rawData) data.push(...part);

                const mxc = await matrixClient.uploadContent(Buffer.from(data), {
                    name: `MemberReport_${moment().format('DDMMMYYYY')}.pdf`,
                    type: 'application/pdf',
                    rawResponse: false
                });
                matrixClient.sendMessage(roomId, {
                    msgtype: "m.file",
                    url: mxc["content_uri"],
                    body: `MemberReport_${moment().format('DDMMMYYYY')}.pdf`,
                    info: {
                        mimetype: "application/pdf",
                        size: data.length,
                    },
                });
            } catch (e) {
                console.error(err);
                matrixClient.sendNotice(roomId, "Error uploading report");
            }
        });
    }
}

export interface AMemberConfig {
    apiKey: string;
    url: string;
    activeMemberCategory: string;
    interestedCategories: string[];
}