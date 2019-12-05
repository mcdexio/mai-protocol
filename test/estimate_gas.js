// NOTE: This is not a test actually. just written to show the gas fee required

const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getContracts, getMarketContract, buildOrder, increaseEvmTime } = require('./utils');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

const gasLimit = 8000000;

contract('EstimateGas', async accounts => {
    let exchange, pool;
    let mpx, collateral, long, short, mkt;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[1];
    const u2 = accounts[2];
    const u3 = accounts[3];
    const u4 = accounts[4];
    const u5 = accounts[5];

    let maker1, maker2, maker3, maker4

    beforeEach(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;

        const mpxContract = await getMarketContract({
            cap: toPrice(8500),
            floor: toPrice(7500),
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContract.mpx;
        pool = mpxContract.pool;
        collateral = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
        mkt = mpxContract.mkt;

        await exchange.methods.approveERC20(collateral._address, mpx._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
            
        maker1 = {
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
        maker2 = {
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
        maker3 = {
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
        maker4 = {
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
    });

    const usePool = async () => {
        await pool.methods.approveERC20(collateral._address, mpx._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
        await pool.methods.approveERC20(mkt._address, mpx._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
        await pool.methods.addAddress(exchange._address)
            .send({ from: admin, gasLimit: gasLimit });
        await exchange.methods.approveERC20(collateral._address, pool._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
        await exchange.methods.approveERC20(long._address, pool._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
        await exchange.methods.approveERC20(short._address, pool._address, infinity)
            .send({ from: admin, gasLimit: gasLimit });
        await exchange.methods.setMintingPool(pool._address)
            .send({ from: admin, gasLimit: gasLimit });
    };
    
    const poolPreCharge = async () => {
        await mkt.methods.transfer(pool._address, toWei(10000))
            .send({ from: admin, gasLimit: gasLimit });
        await admin, long.methods.mint(pool._address, toBase(10))
            .send({ from: admin, gasLimit: gasLimit });
        await admin, short.methods.mint(pool._address, toBase(10))
            .send({ from: admin, gasLimit: gasLimit });
    }

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
                    await send(user, token.methods.approve(exchange._address, infinity));
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
        await matchTest(maker1);
    });

    it('1 maker with pool', async () => {
        usePool();
        await matchTest(maker1);
    });

    it('1 maker with pre-charged pool', async () => {
        usePool();
        poolPreCharge();
        await matchTest(maker1);
    });

    it('2 maker', async () => {
        await matchTest(maker2);
    });

    it('2 maker with pool', async () => {
        usePool();
        await matchTest(maker2);
    });

    it('2 maker with pre-charged pool', async () => {
        usePool();
        poolPreCharge();
        await matchTest(maker2);
    });

    it('3 maker', async () => {
        await matchTest(maker3);
    });

    it('3 maker with pool', async () => {
        usePool();
        await matchTest(maker3);
    });

    it('3 maker with pre-charged pool', async () => {
        usePool();
        poolPreCharge();
        await matchTest(maker3);
    });

    it('4 maker', async () => {
        await matchTest(maker4);
    });

    it('4 maker with pool', async () => {
        usePool();
        await matchTest(maker4);
    });

    it('4 maker with pre-charged pool', async () => {
        usePool();
        poolPreCharge();
        await matchTest(maker4);
    });
});
