const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContract, buildOrder } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

const maxGasLimit = 8000000;


contract('Mai', async accounts => {
    let exchange, proxy, pool;
    let mpx, collateral, long, short, mkt;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

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
        pool = mpxContract.pool;
        mkt = mpxContract.mkt;


        await pool.methods.addAddress(proxy._address)
            .send({ from: admin, gasLimit: maxGasLimit });
        await pool.methods.approveCollateralPool(mpx._address, infinity)
            .send({ from: admin, gasLimit: maxGasLimit });
        await proxy.methods.setCollateralPoolAddress(pool._address)
            .send({ from: admin, gasLimit: maxGasLimit });
        await proxy.methods.approveCollateralPool(mpx._address, pool._address, infinity)
            .send({ from: admin, gasLimit: maxGasLimit });

    });

    const buildMpxOrder = async (config) => {
        const orderParam = {
            trader: config.trader,
            relayer,
            marketContractAddress: mpx._address,
            version: 1,
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

    const getNormalizedBalance = async (contract, user) => {
        const decimals = await contract.methods.decimals().call();
        const balance = await contract.methods.balanceOf(user).call();
        return new BigNumber(balance).div(Math.pow(10, decimals)).toString();
    }

    const withBalanceWatcher = async (contracts, users, callback) => {
        console.log("BEGIN");
        console.log("---------------------------------------------------------------");
        let initialBalance = {};
        for (let i = 0; i < Object.keys(users).length; i++) {
            const userKey = Object.keys(users)[i];
            const userAddress = users[userKey];
            initialBalance[userKey] = {}
            console.log("   $", userKey);
            for (let j = 0; j < Object.keys(contracts).length; j++) {
                const contractKey = Object.keys(contracts)[j];
                const contract = contracts[contractKey];
                initialBalance[userKey][contractKey] = await getNormalizedBalance(contract, userAddress);
                console.log("       -", contractKey, "[I]", initialBalance[userKey][contractKey]);
            }
        }
        console.log("TRANSACTION BEGIN");
        console.log("---------------------------------------------------------------");
        await callback();
        console.log("TRANSACTION END");
        console.log("---------------------------------------------------------------");

        console.log("SUMMARY");
        console.log("---------------------------------------------------------------");
        for (let i = 0; i < Object.keys(users).length; i++) {
            const userKey = Object.keys(users)[i];
            const userAddress = users[userKey];
            console.log("   $", userKey);
            for (let j = 0; j < Object.keys(contracts).length; j++) {
                const contractKey = Object.keys(contracts)[j];
                const contract = contracts[contractKey];
                const remaining = await getNormalizedBalance(contract, userAddress);
                const diff = remaining - initialBalance[userKey][contractKey];
                console.log("       -", contractKey,
                    "[R]", remaining,
                    "[D]", diff > 0 ? "+" + diff : diff);
            }
        }
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
        await send(relayer, exchange.methods.matchMarketContractOrders(
            takerOrder,
            makerOrders,
            matchConfigs.filledAmounts,
            orderAsset
        ));
        if (afterMatching !== undefined) {
            afterMatching();
        }

        // expect balances
        const expectedBalances = matchConfigs.expectedBalances;
        if (expectedBalances !== undefined) {
            for (let i = 0; i < Object.keys(expectedBalances).length; i++) {
                const userName = Object.keys(expectedBalances)[i];

                for (let j = 0; j < Object.keys(expectedBalances[userName]).length; j++) {
                    const tokenName = Object.keys(expectedBalances[userName])[j];

                    const user = users[userName];
                    const token = tokens[tokenName];
                    const expect = expectedBalances[userName][tokenName];
                    const actual = await call(token.methods.balanceOf(user));
                    assert.equal(actual, expect);
                }
            }
        }
    }

    it('buy(long) + buy(short) = mint', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000) },
                u2: { collateral: toWei(10000) },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: toBase(0.1),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: toBase(0.1),
                    price: toPrice(7800),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectedBalances: {
                u1: { collateral: toWei(10000, -70, -2, -0.1), short: toBase(0.1), },
                u2: { collateral: toWei(10000, -30, -2, -0.1), long: toBase(0.1), },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1, -2.4) },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('sell(long) + sell(short) = redeem', async () => {
        const testConfig = {
            initialBalances: {
                u1: { long: toBase(0.1) },
                u2: { short: toBase(0.1) },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: toBase(0.1),
                price: toPrice(8100),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: toBase(0.1),
                    price: toPrice(8000),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectedBalances: {
                u1: { collateral: toWei(50, -2, -0.1), long: toBase(0), },
                u2: { collateral: toWei(50, -2, -0.1), short: toBase(0), },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1) },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('sell(long) + buy(long) = exchange', async () => {
        const testConfig = {
            initialBalances: {
                u1: { long: toBase(0.1) },
                u2: { collateral: toWei(100) },
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: toBase(0.1),
                price: toPrice(8100),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: toBase(0.1),
                    price: toPrice(8000),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(50, -2, -0.1),
                    long: 0,
                },
                u2: {
                    collateral: toWei(100, -50, -2, -0.1),
                    long: toBase(0.1),
                },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1) },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('buy(long) + buy(short) = sell, market', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000), short: toBase(100) },
                u2: { collateral: toWei(10000) },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "sell",
                amount: toBase(1.0),
                price: toPrice(0),
                type: "market",
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(0.1),
                    price: toPrice(7800),
                    makerFeeRate: 250,
                },
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(0.1),
                    price: toPrice(7700),
                    makerFeeRate: 250,
                },
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(0.1),
                    price: toPrice(7600),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1),
                toBase(0.1),
                toBase(0.1),
            ],
            expectedBalances: {
                u1: { collateral: toWei(10000, 70, 80, 90, -6, -0.3), short: toBase(100, -0.3), },
                u2: { collateral: toWei(10000, -70, -80, -90, -6, -0.1), short: toBase(0.3), },
                relayer: { collateral: toWei(6, 6, 0.3, 0.1) },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('sell(short) + buy(short) = exchange', async () => {
        const testConfig = {
            initialBalances: {
                u1: { short: toBase(0.1) },
                u2: { collateral: toWei(100) },
            },
            takerOrder: {
                trader: u2,
                side: "sell",
                amount: toBase(0.1),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(0.1),
                    price: toPrice(8000),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(50, -2, -0.1),
                    short: 0,
                },
                u2: {
                    collateral: toWei(100, -50, -2, -0.1),
                    short: toBase(0.1),
                },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1) },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('buy(short) + sell(short) = exchange', async () => {
        const testConfig = {
            initialBalances: {
                u1: { short: toBase(0.1) },
                u2: { collateral: toWei(100) },
                relayer: {},
            },
            takerOrder: {
                trader: u1,
                side: "buy",
                amount: toBase(0.1),
                price: toPrice(8100),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u2,
                    side: "sell",
                    amount: toBase(0.1),
                    price: toPrice(8000),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(50, -2, -0.1),
                    short: 0,
                },
                u2: {
                    collateral: toWei(100, -50, -2, -0.1),
                    short: toBase(0.1),
                }
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('sell(short) + [buy(short) + sell(long)] = exchange + redeem', async () => {
        const testConfig = {
            initialBalances: {
                u1: { short: toBase(1) },
                u2: { collateral: toWei(10000) },
                u3: { long: toBase(1) },
                relayer: {},
            },
            takerOrder: {
                trader: u1,
                side: "buy",
                amount: toBase(1),
                price: toPrice(8000),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u2,
                    side: "sell",
                    amount: toBase(0.5),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u3,
                    side: "sell",
                    amount: toBase(0.5),
                    price: toPrice(7980),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.5),
                toBase(0.5),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(300, +260, -20, -0.1),
                    short: 0,
                },
                u2: {
                    collateral: toWei(10000, -300, -10, -0.1),
                    short: toBase(0.5),
                },
                u3: {
                    collateral: toWei(240, -10, -0.1),
                    long: toBase(0.5),
                },
                relayer: {
                    collateral: toWei(20, 0.1, 10, 0.1, 10, 0.1)
                }
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('buy(short) + [sell(short) + buy(long)] = exchange + mint', async () => {
        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000) },
                u2: { short: toBase(1) },
                u3: { collateral: toWei(10000) },
                relayer: {},
            },
            takerOrder: {
                trader: u1,
                side: "sell",
                amount: toBase(1),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u2,
                    side: "buy",
                    amount: toBase(0.5),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                },
                {
                    trader: u3,
                    side: "buy",
                    amount: toBase(0.5),
                    price: toPrice(7900),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.5),
                toBase(0.5),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(10000, -300, -20, -0.1, -300),
                    short: toBase(1),
                },
                u2: {
                    collateral: toWei(300, -10, -0.1),
                    short: toBase(0.5),
                },
                u3: {
                    collateral: toWei(10000, -200, -10, -0.1),
                    long: toBase(0.5),
                },
                relayer: {
                    collateral: toWei(20, 0.1, 10, 0.1, 10, 0.1, -12)
                },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

    it('partial fill 1', async () => {
        // step 1: sell 0.4
        const testConfig = {
            initialBalances: {
                u1: {
                    collateral: toWei(10000),
                    long: toBase(0.8)
                },
                u2: {
                    collateral: toWei(10000),
                    long: toBase(0.6),
                    short: toBase(1.8),
                },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "sell",
                amount: toBase(0.4),
                price: toPrice(7900),
                takerFeeRate: 350,
                makerFeeRate: 150,
                gasTokenAmount: toWei(0.1),
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(1),
                    price: toPrice(7900),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
            ],
            filledAmounts: [
                toBase(0.4),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(10000, -160, -4.8, -0.1),
                    long: toBase(1.2),
                },
                u2: {
                    collateral: toWei(10000, 160, -11.2, -0.1),
                    long: toBase(0.2),
                    short: toBase(1.8),
                },
                relayer: {
                    collateral: toWei(4.8, 11.2, 0.1, 0.1),
                },
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);

        // over fill
        let bad1 = null;
        try {
            const badConfig1 = {
                takerOrder: {
                    trader: u2,
                    side: "sell",
                    amount: toBase(1),
                    price: toPrice(7900),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
                makerOrders: [
                    // NOTE: makers will have the same orderID as the previous one because we set fixed salt
                    {
                        trader: u1,
                        side: "buy",
                        amount: toBase(1),
                        price: toPrice(7900),
                        takerFeeRate: 350,
                        makerFeeRate: 150,
                        gasTokenAmount: toWei(0.1),
                    },
                ],
                filledAmounts: [
                    toBase(0.60001),
                ],
                users: { admin, u1, u2, u3, relayer },
                tokens: { collateral, long, short },
                admin: admin,
                gasLimit: 8000000,
            };
            await matchTest(badConfig1);
        } catch (e) {
            bad1 = e;
        }
        assert.notEqual(bad1, null, "should revert 1")
        assert.ok(bad1.message.includes('MAKER_ORDER_OVER_MATCH'), "should throw MAKER_ORDER_OVER_MATCH")

        // step 2: sell 0.2 + mint 0.4
        const testConfig2 = {
            takerOrder: {
                trader: u2,
                side: "sell",
                amount: toBase(1),
                price: toPrice(7900),
                takerFeeRate: 350,
                makerFeeRate: 150,
                gasTokenAmount: toWei(0.1),
            },
            makerOrders: [
                // NOTE: makers will have the same orderID as the previous one because we set fixed salt
                {
                    trader: u1,
                    side: "buy",
                    amount: toBase(1),
                    price: toPrice(7900),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
            ],
            filledAmounts: [
                toBase(0.6),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(
                        10000, -160, -4.8, -0.1,
                        -240, -7.2),
                    long: toBase(1.8),
                },
                u2: {
                    collateral: toWei(
                        10000, 160, -11.2, -0.1,
                        +80, -240, -16.8, -0.1),
                    long: toBase(0),
                    short: toBase(2.2),
                },
                relayer: {
                    collateral: toWei(
                        4.8, 11.2, 0.1, 0.1,
                        7.2, 16.8, 0.1, -9.6), // 9.6 = MP mint fee
                }
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig2);

        // over fill
        let bad2 = null;
        try {
            const badConfig2 = {
                takerOrder: {
                    trader: u3,
                    side: "buy",
                    amount: toBase(0.40001),
                    price: toPrice(8000),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
                makerOrders: [
                    // NOTE: makers will have the same orderID as the previous one because we set fixed salt
                    {
                        trader: u2,
                        side: "sell",
                        amount: toBase(1),
                        price: toPrice(7900),
                        takerFeeRate: 350,
                        makerFeeRate: 150,
                        gasTokenAmount: toWei(0.1),
                    },
                ],
                filledAmounts: [
                    toBase(0.40001),
                ],
                users: { admin, u1, u2, u3, relayer },
                tokens: { collateral, long, short },
                admin: admin,
                gasLimit: 8000000,
            }
            await matchTest(badConfig2);
        } catch (e) {
            bad2 = e;
        }
        assert.notEqual(bad2, null, "should revert 2")
        assert.ok(bad2.message.includes('MAKER_ORDER_OVER_MATCH'), "should throw MAKER_ORDER_OVER_MATCH")

        // over fill
        let bad3 = null;
        try {
            const badConfig3 = {
                takerOrder: {
                    trader: u3,
                    side: "buy",
                    amount: toBase(0.4),
                    price: toPrice(8000),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
                makerOrders: [
                    // NOTE: makers will have the same orderID as the previous one because we set fixed salt
                    {
                        trader: u2,
                        side: "sell",
                        amount: toBase(1),
                        price: toPrice(7900),
                        takerFeeRate: 350,
                        makerFeeRate: 150,
                        gasTokenAmount: toWei(0.1),
                    },
                ],
                filledAmounts: [
                    toBase(0.40001),
                ],
                users: { admin, u1, u2, u3, relayer },
                tokens: { collateral, long, short },
                admin: admin,
                gasLimit: 8000000,
            }
            await matchTest(badConfig3);
        } catch (e) {
            bad3 = e;
        }
        assert.notEqual(bad3, null, "should revert 3")
        assert.ok(bad3.message.includes('TAKER_ORDER_OVER_MATCH'), "should throw TAKER_ORDER_OVER_MATCH")

        // step 3: taker becomes maker. buy 0.4
        const testConfig3 = {
            initialBalances: {
                u3: {
                    short: toBase(0.4)
                },
            },
            takerOrder: {
                trader: u3,
                side: "buy",
                amount: toBase(0.4),
                price: toPrice(8000),
                takerFeeRate: 350,
                makerFeeRate: 150,
                gasTokenAmount: toWei(0.1),
            },
            makerOrders: [
                // NOTE: makers will have the same orderID as the previous one because we set fixed salt
                {
                    trader: u2,
                    side: "sell",
                    amount: toBase(1),
                    price: toPrice(7900),
                    takerFeeRate: 350,
                    makerFeeRate: 150,
                    gasTokenAmount: toWei(0.1),
                },
            ],
            filledAmounts: [
                toBase(0.4),
            ],
            expectedBalances: {
                u2: {
                    collateral: toWei(
                        10000, 160, -11.2, -0.1,
                        +80, -240, -16.8, -0.1,
                        -240, -4.8),
                    long: toBase(0),
                    short: toBase(2.6),
                },
                u3: {
                    collateral: toWei(240, -11.2, -0.1),
                    short: toBase(0),
                },
                relayer: {
                    collateral: toWei(
                        4.8, 11.2, 0.1, 0.1,
                        7.2, 16.8, 0.1, -9.6, // 9.6 = MP mint fee
                        4.8, 11.2, 0.1),
                }
            },
            users: { admin, u1, u2, u3, relayer },
            tokens: { collateral, long, short },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig3);
    });

    it('buy(long) + buy(short) = mint with mtk', async () => {
        const amount = new BigNumber(toBase(0.1));

        const mktInitial = new BigNumber(toWei(10000));
        await mkt.methods.transfer(pool._address, mktInitial.toFixed())
            .send({ from: admin, gasLimit: maxGasLimit });

        const mktFeePerUnit = await mpx.methods.MKT_TOKEN_FEE_PER_UNIT().call();
        const mktRequired = (amount).times(new BigNumber(mktFeePerUnit));


        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000) },
                u2: { collateral: toWei(10000) },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: amount.toFixed(),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: amount.toFixed(),
                    price: toPrice(7800),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                amount.toFixed()
            ],
            expectedBalances: {
                u1: { collateral: toWei(10000, -70, -2, -0.1), short: toBase(0.1), },
                u2: { collateral: toWei(10000, -30, -2, -0.1), long: toBase(0.1), },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1, -2.4) }, // 2.4 = MP mint fee
                proxy: { collateral: 0 },
                pool: {
                    mkt: mktInitial.minus(mktRequired).toFixed(),
                    collateral: toWei(2.4),
                },
            },
            users: { admin, u1, u2, u3, relayer, proxy: proxy._address, pool: pool._address },
            tokens: { collateral, long, short, mkt },
            admin: admin,
            gasLimit: 8000000,
        };

        await matchTest(testConfig);
    });

    it('buy(long) + buy(short) = mint with prepared pos', async () => {
        const amount = new BigNumber(toBase(0.1));
        const mktInitial = new BigNumber(toWei(10000));

        await mkt.methods.transfer(pool._address, mktInitial.toFixed())
            .send({ from: admin, gasLimit: maxGasLimit });
        await short.methods.transfer(pool._address, amount.toFixed())
            .send({ from: admin, gasLimit: maxGasLimit });
        await long.methods.transfer(pool._address, amount.toFixed())
            .send({ from: admin, gasLimit: maxGasLimit });

        const testConfig = {
            initialBalances: {
                u1: { collateral: toWei(10000) },
                u2: { collateral: toWei(10000) },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: amount.toFixed(),
                price: toPrice(7900),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: amount.toFixed(),
                    price: toPrice(7800),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                amount.toFixed()
            ],
            expectedBalances: {
                u1: { collateral: toWei(10000, -70, -2, -0.1), short: toBase(0.1), },
                u2: { collateral: toWei(10000, -30, -2, -0.1), long: toBase(0.1), },
                relayer: { collateral: toWei(2, 2, 0.1, 0.1, -2.4) }, // 2.4 = MP mint fee
                proxy: { collateral: 0 },
                pool: {
                    mkt: mktInitial.toFixed(),
                    collateral: toWei(100, 2.4),
                    long: 0,
                    short: 0,
                },
            },
            users: { admin, u1, u2, u3, relayer, proxy: proxy._address, pool: pool._address },
            tokens: { collateral, long, short, mkt },
            admin: admin,
            gasLimit: 8000000,
        };

        await matchTest(testConfig);
    });

    it('sell(long) + sell(short) = redeem with prepared col', async () => {
        const amount = new BigNumber(toBase(1));

        const ctkUnitFee = new BigNumber(await mpx.methods.COLLATERAL_PER_UNIT().call());
        const ctkRequired = ctkUnitFee.times(amount);

        await collateral.methods.transfer(pool._address, ctkRequired.toFixed())
            .send({ from: admin, gasLimit: maxGasLimit });

        const testConfig = {
            initialBalances: {
                u1: { long: amount.toFixed() },
                u2: { short: amount.toFixed() },
                relayer: {},
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                amount: amount.toFixed(),
                price: toPrice(8100),
                takerFeeRate: 300,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    amount: amount.toFixed(),
                    price: toPrice(8100),
                    makerFeeRate: 100,
                }
            ],
            filledAmounts: [
                amount.toFixed(),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(600, -8, -0.1),
                    long: toBase(0),
                },
                u2: {
                    collateral: toWei(400, -24, -0.1),
                    short: toBase(0),
                },
                relayer: { collateral: toWei(32, 0.1, 0.1) },
                pool: {
                    mkt: 0,
                    collateral: 0,
                    long: amount.toFixed(),
                    short: amount.toFixed(),
                },
            },
            users: { admin, u1, u2, u3, relayer, proxy: proxy._address, pool: pool._address },
            tokens: { collateral, long, short, mkt },
            admin: admin,
            gasLimit: 8000000,
        };
        await matchTest(testConfig);
    });

});
