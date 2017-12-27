import * as express from "express";
import * as path from "path";
import * as bodyParser from "body-parser";
import { LogService } from "matrix-js-snippets";
import { Server } from "typescript-rest";
import * as _ from "lodash";
import config from "../config";
import { ApiError } from "./ApiError";

export default class Webserver {

    private app: express.Application;

    constructor() {
        this.app = express();

        this.configure();
        this.loadRoutes();
    }

    private loadRoutes() {
        const apis = ["honeywell"].map(a => path.join(__dirname, a, "*.js"));
        const router = express.Router();
        apis.forEach(a => Server.loadServices(router, [a]));
        const routes = _.uniq(router.stack.map(r => r.route.path));
        for (const route of routes) {
            this.app.options(route, (_req, res) => res.sendStatus(200));
            LogService.info("Webserver", "Registered route: " + route);
        }
        this.app.use(router);

        // We register the default route last to make sure we don't override anything by accident.
        // We'll pass off all other requests to the web app
        // this.app.get("*", (_req, res) => {
        //     res.sendFile(path.join(__dirname, "..", "..", "web", "index.html"));
        // });

        // Set up the error handler
        this.app.use((err: any, _req, res, next) => {
            if (err instanceof ApiError) {
                // Don't do anything for 'connection reset'
                if (res.headersSent) return next(err);

                LogService.warn("Webserver", "Handling ApiError " + err.statusCode + " " + JSON.stringify(err.jsonResponse));
                res.setHeader("Content-Type", "application/json");
                res.status(err.statusCode);
                res.json(err.jsonResponse);
            } else next(err);
        });
    }

    private configure() {
        this.app.use(express.static(path.join(__dirname, "..", "..", "web")));
        this.app.use(bodyParser.json());
        this.app.use((req, _res, next) => {
            LogService.verbose("Webserver", "Incoming request: " + req.method + " " + req.url);
            next();
        });
    }

    start() {
        this.app.listen(config.web.port, config.web.bind);
        LogService.info("Webserver", "API and UI listening on " + config.web.bind + ":" + config.web.port);
    }
}