const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContracts } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { fromRpcSig } = require('ethereumjs-util');

const bases = new BigNumber('100000');
const weis = new BigNumber('1000000000000000000');

const toBase = x => {
    return new BigNumber(x).times(bases).toString();
}

const fromBase = x => {
    return new BigNumber(x).div(bases).toString();
}

const toWei = x => {
    return new BigNumber(x).times(weis).toString();
};

const fromWei = x => {
    return new BigNumber(x).div(weis).toString();
};

const infinity = '999999999999999999999999999999999999999999';

contract('Match', async accounts => {
    let exchange, proxy;
    let mpx, collateral, long, short;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    beforeEach(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
        proxy = contracts.proxy;

        const mpxContracs = await getMarketContracts({
            cap: 8500e10,
            floor: 7500e10,
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContracs.mpx;
        collateral = mpxContracs.collateral;
        long = mpxContracs.long;
        short = mpxContracs.short;
    });

    const getOrderSignature = async (order, baseToken, quoteToken) => {
        const copyedOrder = JSON.parse(JSON.stringify(order));
        copyedOrder.baseToken = baseToken;
        copyedOrder.quoteToken = quoteToken;

        const orderHash = getOrderHash(copyedOrder);
        const newWeb3 = getWeb3();

        // This depends on the client, ganache-cli/testrpc auto prefix the message header to message
        // So we have to set the method ID to 0 even through we use web3.eth.sign
        const signature = fromRpcSig(await newWeb3.eth.sign(orderHash, order.trader));
        signature.config = `0x${signature.v.toString(16)}00` + '0'.repeat(60);
        const isValid = isValidSignature(order.trader, signature, orderHash);

        assert.equal(true, isValid);
        order.signature = signature;
        order.orderHash = orderHash;
    };

    const buildOrder = async (orderParam, baseTokenAddress, quoteTokenAddress) => {
        const order = {
            trader: orderParam.trader,
            relayer: orderParam.relayer,
            data: generateOrderData(
                orderParam.version,
                orderParam.side === 'sell',
                orderParam.type === 'market',
                orderParam.expiredAtSeconds,
                orderParam.asMakerFeeRate,
                orderParam.asTakerFeeRate,
                orderParam.makerRebateRate || '0',
                Math.round(Math.random() * 10000000),
                false,
                orderParam.position === 'long',
            ),
            baseTokenAmount: orderParam.baseTokenAmount,
            quoteTokenAmount: orderParam.quoteTokenAmount,
            gasTokenAmount: orderParam.gasTokenAmount
        };

        await getOrderSignature(order, baseTokenAddress, quoteTokenAddress);

        return order;
    };

    const buildMpxOrder = async (config) => {
        const orderParam = {
            trader: config.trader,
            relayer,
            version: 2,
            side: config.side,
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: config.makerFeeRate || '0',
            asTakerFeeRate: config.takerFeeRate || '0',
            baseTokenAmount: config.baseAmount,
            quoteTokenAmount: config.quoteAmount,
            gasTokenAmount: config.gasAmount || toWei(0.1),
            position: config.position,
        };
        return await buildOrder(
            orderParam, 
            config.position === 'long' ? long._address: short._address, 
            collateral._address
        );
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
                    - expectBalances    {}
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

        const call = async (method) => {
            return await method.call();
        }
        const send = async (user, method) => {
            return await method.send({ from: user, gasLimit: gasLimit });
        }

        // initialBalances
        const initialBalances = matchConfigs.initialBalances;
        if (initialBalances !== undefined) {
            console.log("===> initialBalances")
            for (let i = 0; i < Object.keys(initialBalances).length; i++) {
                const tokenName = Object.keys(initialBalances)[i];
                const token = tokens[tokenName];
                for (let j = 0; j < Object.keys(initialBalances[tokenName]).length; j++) {
                    const userName = Object.keys(initialBalances[tokenName])[j];
                    const user = users[userName];
                    const amount = initialBalances[tokenName][userName];
                    if (amount > 0) {
                        await send(admin, token.methods.mint(user, amount));
                    }
                    await send(user, token.methods.approve(proxy._address, infinity));
                }
            }
        }

        // build orders
        console.log("===> buildOrders")
        const takerOrder = await buildMpxOrder(matchConfigs.takerOrder);
        let makerOrders = [];
        for (let i = 0; i < matchConfigs.makerOrders.length; i++) {
            const makerOrder = await buildMpxOrder(matchConfigs.makerOrders[i]);
            makerOrders.push(makerOrder);
        }

        // prepare
        await send(admin, proxy.methods.approveMarketContractPool(mpx._address));

        if (beforeMatching !== undefined) {
            beforeMatching();
        }
        // matching
        console.log("===> matching")
        await send(relayer, exchange.methods.matchOrders(
            takerOrder,
            makerOrders,
            matchConfigs.filledAmounts,
            matchConfigs.orderAsset
        ));
        if (afterMatching !== undefined) {
            afterMatching();
        }

        // expect balances
        const expectBalances = matchConfigs.expectBalances;
        if (expectBalances !== undefined) {
            console.log("===> check balance")
            for (let i = 0; i < Object.keys(expectBalances).length; i++) {
                const tokenName = Object.keys(expectBalances)[i];
                const token = tokens[tokenName];

                for (let j = 0; j < Object.keys(expectBalances[tokenName]).length; j++) {
                    const userName = Object.keys(expectBalances[tokenName])[j];
                    const user = users[userName];
                    const expect = expectBalances[tokenName][userName];
                    const actural = await call(token.methods.balanceOf(user));
                    assert.equal(expect, actural, userName + " has unexpected balance");
                }
            }
        }
    }
    
    /*
        matchConfigs    - initialBalances   { token: user: amount }
                    - taker             object
                    - makers            []
                    - orderAsset        {}
                    - filledAmounts     []
                    - expectBalances    {}
                    - users
                    - tokens 
                    - admin
                    - gasLimit
    */
    it('buy(long) + buy(short) = mint', async () => {
        const testConfig = {
            initialBalances: {
                collateral: {
                    u1: toWei(10000),
                    u2: toWei(10000),
                    relayer: 0,
                },
                long: { u1: 0, u2: 0, relayer: 0 },
                short: { u1: 0, u2: 0, relayer: 0 },
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                position: "long",
                baseAmount: toBase(0.1),
                quoteAmount: toWei(40),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    position: "short",
                    baseAmount: toBase(0.1),
                    quoteAmount: toWei(70),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectBalances: {
                collateral: {
                    u1: toWei(10000 - 70 - 2 - 0.1),
                    u2: toWei(10000 - 30 - 2 - 0.1),
                },
                long: { 
                    u1: 0, 
                    u2: toBase(0.1),
                },
                short: {
                    u1: toBase(0.1), 
                    u2: 0
                },
            },
            orderAsset: {
                marketContractAddress: mpx._address,
                relayer: relayer,
            },
            users: { admin: admin, u1: u1, u2: u2, u3: u3, relayer: relayer },
            tokens: { collateral: collateral, long: long, short: short },
            admin: admin,
            gasLimit: 8000000,
        }
        await matchTest(testConfig);
    });

    it('sell(long) + sell(short) = redeem', async () => {
        const testConfig = {
            initialBalances: {
                collateral: {
                    u1: 0,
                    u2: 0,
                    relayer: 0,
                },
                long: { 
                    u1: toBase(0.1), 
                    u2: 0, 
                    relayer: 0 },
                short: { 
                    u1: 0, 
                    u2: toBase(0.1), 
                    relayer: 0 
                },
            },
            takerOrder: {
                trader: u2,
                side: "sell",
                position: "short",
                baseAmount: toBase(0.1),
                quoteAmount: toWei(40),
                takerFeeRate: 250,
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "sell",
                    position: "long",
                    baseAmount: toBase(0.1),
                    quoteAmount: toWei(50),
                    makerFeeRate: 250,
                }
            ],
            filledAmounts: [
                toBase(0.1)
            ],
            expectBalances: {
                collateral: {
                    u1: toWei(50 - 2 - 0.1),
                    u2: toWei(50 - 2 - 0.1),
                },
                long: { 
                    u1: 0, 
                    u2: 0,
                },
                short: {
                    u1: 0, 
                    u2: 0,
                },
            },
            orderAsset: {
                marketContractAddress: mpx._address,
                relayer: relayer,
            },
            users: { admin: admin, u1: u1, u2: u2, u3: u3, relayer: relayer },
            tokens: { collateral: collateral, long: long, short: short },
            admin: admin,
            gasLimit: 8000000,
        }
        await matchTest(testConfig);
    });


    /*
    it('buy long + buy short = mint == multi', async () => {

        console.log(toBase("0.25"));

        await initialBalances(collateral, admin, [
            { address: u1, amount: toWei("10000") },
            { address: u2, amount: toWei("10000") },
            { address: u3, amount: toWei("10000") },
            { address: u4, amount: toWei("10000") },
        ]);
        const config = {
            takerOrder: {
                creator: buildBuyLongOrder,
                user: u1,
                amount: 1,
                quote: 5000,
            },
            makerOrders: [
                {
                    creator: buildBuyShortOrder,
                    user: u2,
                    amount: 0.25,
                    quote: 1000,
                },
                {
                    creator: buildBuyShortOrder,
                    user: u3,
                    amount: 0.25,
                    quote: 1500,
                },
                {
                    creator: buildBuyShortOrder,
                    user: u4,
                    amount: 0.5,
                    quote: 2000,
                }
            ],
            filledAmounts: [
                toBase("0.25"),
                toBase("0.25"),
                toBase("0.5"),
            ],
            orderAsset: orderAsset,
        }

        await withBalanceWatcher(
            tokens,
            { u1: u1, u2: u2, u3: u3, u4: u4, proxy: proxy._address },
            async () => {
                await matchTest(config);
            });
    });

    it('sell long + sell short = mint -- single', async () => {
        const config = {
            takerOrder: {
                creator: buildSellLongOrder,
                user: u2,
                amount: 1,
                quote: 3000,
            },
            makerOrders: [
                {
                    creator: buildSellShortOrder,
                    user: u1,
                    amount: 1,
                    quote: 2000,
                }
            ],
            filledAmounts: [
                toBase("1")
            ],
            orderAsset: orderAsset,
        }

        await withBalanceWatcher(
            tokens,
            { u1: u1, u2: u2, proxy: proxy._address },
            async () => {
                await matchTest(config);
            });
    });

    it('sell long + sell short = mint -- multi', async () => {
        const config = {
            takerOrder: {
                creator: buildSellLongOrder,
                user: u1,
                amount: 1,
                quote: 3000,
            },
            makerOrders: [
                {
                    creator: buildSellShortOrder,
                    user: u2,
                    amount: 0.25,
                    quote: 500,
                },
                {
                    creator: buildSellShortOrder,
                    user: u3,
                    amount: 0.25,
                    quote: 600,
                },
                {
                    creator: buildSellShortOrder,
                    user: u4,
                    amount: 0.5,
                    quote: 1000,
                }
            ],
            filledAmounts: [
                toBase("0.25"),
                toBase("0.25"),
                toBase("0.5")
            ],
            orderAsset: orderAsset,
        }

        await withBalanceWatcher(
            tokens,
            { u1: u1, u2: u2, u3: u3, u4: u4, proxy: proxy._address },
            async () => {
                await matchTest(config);
            });
    });
    

    it('buy long + sell long = exchange -- single', async () => {
        await initialBalances(collateral, admin, [
            { address: u1, amount: toWei("10000") },
            { address: u2, amount: toWei("10000") },
        ]);
        const config = {
            takerOrder: {
                creator: buildBuyLongOrder,
                user: u1,
                amount: 2,
                quote: 7000, // 3500 per token
            },
            makerOrders: [
                {
                    creator: buildSellLongOrder,
                    user: u2,
                    amount: 1,
                    quote: 2800,
                },
            ],
            filledAmounts: [
                toBase("1"),
            ],
            orderAsset: orderAsset,
        }

        await withBalanceWatcher(
            tokens,
            { u1: u1, u2: u2, proxy: proxy._address },
            async () => {
                await matchTest(config);
            });
    });
    

    it('buy long + sell long = exchange -- multi', async () => {
        await initialBalances(collateral, admin, [
            { address: u1, amount: toWei("10000") },
            { address: u2, amount: toWei("10000") },
            { address: u3, amount: toWei("10000") },
        ]);
        const config = {
            takerOrder: {
                creator: buildBuyLongOrder,
                user: u3,
                amount: 2,
                quote: 7000, // 3500 per token
            },
            makerOrders: [
                {
                    creator: buildSellLongOrder,
                    user: u2,
                    amount: 1,
                    quote: 2800,
                },
                {
                    creator: buildSellLongOrder,
                    user: u1,
                    amount: 0.5,
                    quote: 1500,
                },
            ],
            filledAmounts: [
                toBase("1"),
                toBase("0.5"),
            ],
            orderAsset: orderAsset,
        }

        await withBalanceWatcher(
            tokens,
            { u1: u1, u2: u2, u3: u3, proxy: proxy._address },
            async () => {
                await matchTest(config);
            });
    });
    */
});
