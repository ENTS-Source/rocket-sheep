import * as winston from "winston";
import * as chalk from "chalk";
import * as config from "config";
import * as fs from "fs";
import * as moment from "moment";

try {
    fs.mkdirSync('logs')
} catch (err) {
    if (err.code !== 'EEXIST') throw err
}

const TERM_COLORS = {
    error: "red",
    warn: "yellow",
    info: "blue",
    verbose: "white",
    silly: "grey",
};

function winstonColorFormatter(options) {
    options.level = chalk[TERM_COLORS[options.level]](options.level);
    return winstonFormatter(options);
}

function winstonFormatter(options) {
    return options.timestamp() + ' ' + options.level + ' ' + (options.message ? options.message : '') +
        (options.meta && Object.keys(options.meta).length ? '\n\t' + JSON.stringify(options.meta) : '' );
}

function getTimestamp() {
    return moment().format('MMM-D-YYYY HH:mm:ss.SSS Z');
}

var loggingConfig = config.get('logging');

var transports = [];
//noinspection TypeScriptUnresolvedVariable,TypeScriptUnresolvedFunction
transports.push(new (winston.transports.File)({
    json: false,
    name: "file",
    filename: loggingConfig.file,
    timestamp: getTimestamp,
    formatter: winstonFormatter,
    level: loggingConfig.fileLevel,
    maxsize: loggingConfig.rotate.size,
    maxFiles: loggingConfig.rotate.count,
    zippedArchive: false
}));

if (loggingConfig.console) {
    //noinspection TypeScriptUnresolvedVariable,TypeScriptUnresolvedFunction
    transports.push(new (winston.transports.Console)({
        json: false,
        name: "console",
        timestamp: getTimestamp,
        formatter: winstonColorFormatter,
        level: loggingConfig.consoleLevel
    }));
}

//noinspection TypeScriptValidateTypes
var log = new winston.Logger({
    transports: transports,
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        verbose: 3,
        silly: 4
    }
});

function doLog(level: string, module: string, messageOrObject: any): void {
    if (typeof(messageOrObject) === 'object')
        messageOrObject = JSON.stringify(messageOrObject);
    var message = "[" + module + "] " + messageOrObject;
    log.log(level, message);
}

export class LogService {
    public static info(module: string, message: any): void {
        doLog('info', module, message);
    }

    public static warn(module: string, message: any): void {
        doLog('warn', module, message);
    }

    public static error(module: string, message: any): void {
        doLog('error', module, message);
    }

    public static verbose(module: string, message: any): void {
        doLog('verbose', module, message);
    }

    public static silly(module: string, message: any): void {
        doLog('silly', module, message);
    }
}