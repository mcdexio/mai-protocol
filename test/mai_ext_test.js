const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContract, buildOrder } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

contract('Mai', async accounts => {
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
            version: 1,
            side: config.side,
            type: 'limit',
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
                    assert.equal(actual, expect, `user: ${userName}, token: ${tokenName}`);
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

    it('fail to set set market registry address', async () => {
        try {
            await exchange.methods.setMarketRegistryAddress("0x0000000000000000000000000000000000000000")
                .send({ from: u1 });
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("NOT_OWNER"), true);
            return;
        }
    });

});
