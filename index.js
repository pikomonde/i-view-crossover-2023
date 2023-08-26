"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const redis = require("redis");
const memcached = require("memcached");
const util = require("util");
const KEY = `account1/balance`;
const DEFAULT_BALANCE = 100;
const MAX_EXPIRATION = 60 * 60 * 24 * 30;
const memcachedClient = new memcached(`${process.env.ENDPOINT}:${process.env.PORT}`);
exports.chargeRequestRedis = async function (input) {
    var responses = [
        chargeRedisReq(),
        chargeRedisReq(),
        chargeRedisReq(),
        chargeRedisReq(),
        chargeRedisReq(),
        chargeRedisReq(),
    ]
    var awaitResponses = [
        await responses[0],
        await responses[1],
        await responses[2],
        await responses[3],
        await responses[4],
        await responses[5],
    ]
    printResponses(awaitResponses);
    return null;
};
async function chargeRedisReq() {
    const redisClient = await getRedisClient();
    var startTime = new Date().getTime();
    var remainingBalance = await getBalanceRedis(redisClient, KEY);
    var charges = getCharges();
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!isAuthorized) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
            startTime,
            timeElapsed: (new Date().getTime() - startTime),
        };
    }
    remainingBalance = await chargeRedis(redisClient, KEY, charges);
    var timeElapsed = (new Date().getTime() - startTime);
    await disconnectRedis(redisClient);
    return {
        remainingBalance,
        charges,
        isAuthorized,
        startTime,
        timeElapsed,
    };
};
exports.resetRedis = async function () {
    const redisClient = await getRedisClient();
    const ret = new Promise((resolve, reject) => {
        redisClient.set(KEY, String(DEFAULT_BALANCE), (err, res) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(DEFAULT_BALANCE);
            }
        });
    });
    await disconnectRedis(redisClient);
    return ret;
};
exports.resetMemcached = async function () {
    var ret = new Promise((resolve, reject) => {
        memcachedClient.set(KEY, DEFAULT_BALANCE, MAX_EXPIRATION, (res, error) => {
            if (error)
                resolve(res);
            else
                reject(DEFAULT_BALANCE);
        });
    });
    return ret;
};
exports.chargeRequestMemcached = async function (input) {
    var responses = [
        chargeMemcachedReq(),
        chargeMemcachedReq(),
        chargeMemcachedReq(),
        chargeMemcachedReq(),
        chargeMemcachedReq(),
        chargeMemcachedReq(),
    ]
    var awaitResponses = [
        await responses[0],
        await responses[1],
        await responses[2],
        await responses[3],
        await responses[4],
        await responses[5],
    ]
    printResponses(awaitResponses);
    return null;
};
async function chargeMemcachedReq() {
    var remainingBalance = await getBalanceMemcached(KEY);
    var startTime = new Date().getTime();
    const charges = getCharges();
    const isAuthorized = authorizeRequest(remainingBalance, charges);
    if (!authorizeRequest(remainingBalance, charges)) {
        return {
            remainingBalance,
            isAuthorized,
            charges: 0,
            startTime,
            timeElapsed: (new Date().getTime() - startTime),
        };
    }
    remainingBalance = await chargeMemcached(KEY, charges);
    return {
        remainingBalance,
        charges,
        isAuthorized,
        startTime,
        timeElapsed: (new Date().getTime() - startTime),
    };
};
function printResponses(responses) {
    responses.sort(function(a, b){return a.startTime - b.startTime})
    var sum = 0;
    var min = 2000;
    var max = -1;
    responses.forEach(response => {
        console.log(
            "remainingBalance: " + response.remainingBalance + ", " +
            "isAuthorized: " + response.isAuthorized + ", " +
            "charges: " + response.charges + ", " +
            "startTime: " + response.startTime + ", " +
            "timeElapsed: " + response.timeElapsed
        );
        sum += response.timeElapsed;
        if (response.timeElapsed < min) {
            min = response.timeElapsed;
        }
        if (response.timeElapsed > max) {
            max = response.timeElapsed;
        }
    })
    var average = sum / responses.length;
    console.log("sum: " + sum)
    console.log("min: " + min)
    console.log("max: " + max)
    console.log("average: " + average)
}
async function getRedisClient() {
    return new Promise((resolve, reject) => {
        try {
            const client = new redis.RedisClient({
                host: process.env.ENDPOINT,
                port: parseInt(process.env.PORT || "6379"),
            });
            client.on("ready", () => {
                console.log('redis client ready');
                resolve(client);
            });
        }
        catch (error) {
            reject(error);
        }
    });
}
async function disconnectRedis(client) {
    return new Promise((resolve, reject) => {
        client.quit((error, res) => {
            if (error) {
                reject(error);
            }
            else if (res == "OK") {
                console.log('redis client disconnected');
                resolve(res);
            }
            else {
                reject("unknown error closing redis connection.");
            }
        });
    });
}
function authorizeRequest(remainingBalance, charges) {
    return remainingBalance >= charges;
}
function getCharges() {
    return 23;
}
async function getBalanceRedis(redisClient, key) {
    const res = await util.promisify(redisClient.get).bind(redisClient).call(redisClient, key);
    return parseInt(res || "0");
}
async function chargeRedis(redisClient, key, charges) {
    // await new Promise(r => setTimeout(r, 100));
    return util.promisify(redisClient.decrby).bind(redisClient).call(redisClient, key, charges);
}
async function getBalanceMemcached(key) {
    return new Promise((resolve, reject) => {
        memcachedClient.get(key, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(Number(data));
            }
        });
    });
}
async function chargeMemcached(key, charges) {
    // await new Promise(r => setTimeout(r, 100));
    return new Promise((resolve, reject) => {
        memcachedClient.decr(key, charges, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                return resolve(Number(result));
            }
        });
    });
}
