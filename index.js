"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const redis = require("redis");
const memcached = require("memcached");
const util = require("util");
const {performance} = require('perf_hooks');
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
    var startTime = performance.now();
    var charges = getCharges();
    var response = await new Promise((resolve, reject) => {
        var luaScript = "local balance = redis.call('GET', KEYS[1]);" +
          "if( tonumber(balance) >= tonumber(ARGV[1]) ) then" +
          "  return { true, redis.call('DECRBY', KEYS[1], ARGV[1]) }" +
          "else" +
          "  return { false, balance }" +
          "end";
        redisClient.eval(luaScript, 1, KEY, charges, function(err, res) {
            if (err) {
                reject(err);
            }
            else {
                resolve({
                    "isAuthorized": Boolean(res[0]),
                    "remainingBalance": Number(res[1]),
                });
            }
          });
    });
    var timeElapsed = (performance.now() - startTime);
    await disconnectRedis(redisClient);
    return {
        remainingBalance: response.remainingBalance,
        charges: response.isAuthorized ? charges : 0,
        isAuthorized: response.isAuthorized,
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
    var remainingBalanceWithCas = await getBalanceMemcachedWithCas(KEY);
    var startTime = performance.now();;
    const charges = getCharges();
    const isAuthorized = authorizeRequest(remainingBalanceWithCas.data, charges);
    if (!authorizeRequest(remainingBalanceWithCas.data, charges)) {
        return {
            remainingBalance: remainingBalanceWithCas.data,
            isAuthorized,
            charges: 0,
            startTime,
            timeElapsed: (performance.now() - startTime),
        };
    }
    var updatedRemainingBalance = remainingBalanceWithCas.data - charges;
    var successCharge = await chargeMemcached(KEY, remainingBalanceWithCas.cas, updatedRemainingBalance);
    var remainingBalance = 0;
    if (!successCharge) {
        remainingBalance = await getBalanceMemcached(KEY);
    }
    return {
        remainingBalance: successCharge ? updatedRemainingBalance : remainingBalance,
        charges: successCharge ? charges : 0,
        isAuthorized: isAuthorized && successCharge,
        startTime,
        timeElapsed: (performance.now() - startTime),
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
async function getBalanceMemcachedWithCas(key) {
    return new Promise((resolve, reject) => {
        memcachedClient.gets(key, (err, data) => {
            if (err) {
                reject(err);
            }
            else {
                resolve({
                    "data": Number(data[key]),
                    "cas": Number(data.cas),
                });
            }
        });
    });
}
async function chargeMemcached(key, casKey, newBalance) {
    // await new Promise(r => setTimeout(r, 100));
    return new Promise((resolve, reject) => {
        memcachedClient.cas(key, newBalance, casKey, MAX_EXPIRATION, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                return resolve(Boolean(result));
            }
        });
    });
}
