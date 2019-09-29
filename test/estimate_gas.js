// NOTE: This is not a test actually. just written to show the gas fee required

const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getContracts, getMarketContract, buildOrder, increaseEvmTime } = require('./utils');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

contract('EstimateGas', async accounts => {
    let exchange, proxy;
    let mpx, collateral, long, short;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[1];
    const u2 = accounts[2];
    const u3 = accounts[3];
    const u4 = accounts[4];
    const u5 = accounts[5];

    beforeEach(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
        proxy = contracts.proxy;

        const mpxContract = await getMarketContract({
            cap: toPrice(8500),
            floor: toPrice(7500),
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContract.mpx;
        collateral = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
    });

    const buildMpxOrder = async (config) => {
        const orderParam = {
            trader: config.trader,
            relayer,
            marketContractAddress: mpx._address,
            version: 2,
            side: config.side,
            type: config.type || 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: config.makerFeeRate || '0',
            asTakerFeeRate: config.takerFeeRate || '0',
            amount: config.amount,
            price: config.price,
            gasTokenAmount: config.gasTokenAmount || toWei(0.1),
        };
        return await buildOrder(orderParam);
    }

    /*
    matchConfigs    - initialBalances   { token: user: amount }
                    - taker             object
                    - makers            []
                    - orderAsset        {}
                    - filledAmounts     []
                    - expectedBalances    {}
                    - users
                    - tokens
                    - admin
                    - gasLimit
    */
    const matchTest = async (matchConfigs, beforeMatching = undefined, afterMatching = undefined) => {
        const gasLimit = matchConfigs.gasLimit || 8000000;
        const admin = matchConfigs.admin;
        const users = matchConfigs.users || {};
        const tokens = matchConfigs.tokens || {};
        const orderAsset = matchConfigs.orderAsset || {
            marketContractAddress: mpx._address,
            relayer: relayer,
        };

        const call = async (method) => {
            return await method.call();
        }
        const send = async (user, method) => {
            return await method.send({ from: user, gasLimit: gasLimit });
        }
        const estimateGas = async (user, method) => {
            return await method.estimateGas({ from: user, gasLimit: gasLimit });
        }

        // initialBalances
        const initialBalances = matchConfigs.initialBalances;
        if (initialBalances !== undefined) {
            for (let i = 0; i < Object.keys(initialBalances).length; i++) {
                const userName = Object.keys(initialBalances)[i];
                for (let j = 0; j < Object.keys(tokens).length; j++) {
                    const tokenName = Object.keys(tokens)[j];

                    const user = users[userName];
                    const token = tokens[tokenName];
                    const amount = initialBalances[userName][tokenName] || 0;
                    if (amount > 0) {
                        await send(admin, token.methods.mint(user, amount));
                    }
                    await send(user, token.methods.approve(proxy._address, infinity));
                }
            }
        }

        // build orders
        const takerOrder = await buildMpxOrder(matchConfigs.takerOrder);
        let makerOrders = [];
        for (let i = 0; i < matchConfigs.makerOrders.length; i++) {
            const makerOrder = await buildMpxOrder(matchConfigs.makerOrders[i]);
            makerOrders.push(makerOrder);
        }

        // prepare
        await send(admin, proxy.methods.approveCollateralPool(mpx._address, mpx._address, infinity));
        if (beforeMatching !== undefined) {
            beforeMatching();
        }
        // matching
        let gas = await estimateGas(relayer, exchange.methods.matchMarketContractOrders(
            takerOrder,
            makerOrders,
            matchConfigs.filledAmounts,
            orderAsset
        ));
        console.log('estimateGas: ', gas);
    }

    it('1 maker', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000), short: toBase(2) },
                u5: { collateral: toWei(10000), long: toBase(1) },
                relayer: {},
            },
            takerOrder: {
                trader: u5,
                side: "sell",
                amount: toBase(3),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(3),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(3)
            ],
            users: { admin, u1, u2, u3, u4, u5, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('2 makers', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000), short: toBase(2) },
                u2: { collateral: toWei(10000), short: toBase(1) },
                u5: { collateral: toWei(10000), long: toBase(1) },
                relayer: {},
            },
            takerOrder: {
                trader: u5,
                side: "sell",
                amount: toBase(5),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(3),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u2,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(3), toBase(2),
            ],
            users: { admin, u1, u2, u3, u4, u5, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('3 makers', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000), short: toBase(2) },
                u2: { collateral: toWei(10000), short: toBase(1) },
                u3: { collateral: toWei(10000), short: toBase(1) },
                u5: { collateral: toWei(10000), long: toBase(1) },
                relayer: {},
            },
            takerOrder: {
                trader: u5,
                side: "sell",
                amount: toBase(7),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(3),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u2,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u3,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(3), toBase(2), toBase(2),
            ],
            users: { admin, u1, u2, u3, u4, u5, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('4 makers', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000), short: toBase(2) },
                u2: { collateral: toWei(10000), short: toBase(1) },
                u3: { collateral: toWei(10000), short: toBase(1) },
                u4: { collateral: toWei(10000), short: toBase(1) },
                u5: { collateral: toWei(10000), long: toBase(1) },
                relayer: {},
            },
            takerOrder: {
                trader: u5,
                side: "sell",
                amount: toBase(9),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(3),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u2,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u3,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u4,
                    side: "buy",
                    amount: toBase(2),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(3), toBase(2), toBase(2), toBase(2),
            ],
            users: { admin, u1, u2, u3, u4, u5, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });


});
