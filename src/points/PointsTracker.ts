import { PointsConfig } from "../plugin/impl/PointsPlugin";
import { MatrixClient } from "matrix-bot-sdk";

const EVENT_TYPE = "ca.ents.points";

export class PointsTracker {

    constructor(private matrixClient: MatrixClient, private config: PointsConfig) {
    }

    public async incrementPoints(user: string, delta: number, task: string): Promise<any> {
        const current = await this.getCount();
        return this.matrixClient.sendStateEvent(this.config.statsRoom, EVENT_TYPE, this.config.milestoneId, {points: current + delta}).then(() => {
            const content = {
                msgtype: "m.notice",
                body: user ? `Wow! ${user} has just earned ${delta} points towards the goal!` : `Wow! The space is ${delta} points closer to the goal!`,
                "ca.ents.points": {
                    user: user,
                    delta: delta,
                    goal: this.config.goal,
                    updatedTotal: current + delta,
                    milestoneId: this.config.milestoneId,
                    task: task,
                },
            };

            const promises = [];
            const widgetId = `${EVENT_TYPE}_${this.config.milestoneId}`;
            promises.push(this.matrixClient.sendStateEvent(this.config.advertiseRoom, "im.vector.modular.widgets", widgetId, {
                type: "customwidget",
                url: this.config.widgetUrl,
                name: this.config.widgetName,
                data: {title: `${current + delta}/${this.config.goal}`},
                waitForIframeLoad: false,
                id: widgetId,
            }));
            promises.push(this.matrixClient.sendMessage(this.config.statsRoom, content));
            if (this.config.statsRoom !== this.config.advertiseRoom) promises.push(this.matrixClient.sendMessage(this.config.advertiseRoom, content));

            return Promise.all(promises);
        });
    }

    public async getCount(): Promise<number> {
        const event = await this.matrixClient.getRoomStateEvent(this.config.statsRoom, EVENT_TYPE, this.config.milestoneId);

        if (!event || !event['content'] || !event['content']['points']) return 0;
        return event['content']['points'];
    }
}