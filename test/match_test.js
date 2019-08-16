const assert = require('assert');
const MarketContract = artifacts.require('../interfaces/IMarketContract.sol');
const IERC20 = artifacts.require('./interfaces/IERC20.sol');
const BigNumber = require('bignumber.js');
const { newContract, getWeb3, setHotAmount, getContracts, clone } = require('./utils');
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
    let exchange, proxy, hot;
    let marketContract, collateralToken, longPositionToken, shortPositionToken;
    let orderAsset;
    let tokens;

    const relayer = accounts[9];
    const admin = accounts[0];
    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];
    const u4 = accounts[7];

    const marketContractAddress = "0x3A92C58C7152B3b2d5F56E8d47Ce87d668b47B47";
    beforeEach(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
        proxy = contracts.proxy;
        hot = contracts.hot;

        marketContract = await getContract(MarketContract, marketContractAddress);
        collateralToken = await getContract(IERC20, await marketContract.methods.COLLATERAL_TOKEN_ADDRESS().call());
        longPositionToken = await getContract(IERC20, await marketContract.methods.LONG_POSITION_TOKEN().call());
        shortPositionToken = await getContract(IERC20, await marketContract.methods.SHORT_POSITION_TOKEN().call());

        orderAsset = {
            marketContractAddress: marketContractAddress,
            relayer: relayer,
            takerPositionToken: marketContractAddress,
            collateralToken: marketContractAddress,
            collateralPerUnit: marketContractAddress,
            collateralTokenDecimals: 0,
            positionTokenDecimals: 0,
        }
        tokens = {
            "CTK  ": collateralToken,
            "SHORT": shortPositionToken,
            "LONG ": longPositionToken,
        }
    });
    const sendParams = { from: admin, gas: 8000000 };

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

    const buildOrder = async (orderParam, baseTokenAddress, quoteTokenAddress, isLong) => {
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
                isLong,
            ),
            baseTokenAmount: orderParam.baseTokenAmount,
            quoteTokenAmount: orderParam.quoteTokenAmount,
            gasTokenAmount: orderParam.gasTokenAmount
        };

        await getOrderSignature(order, baseTokenAddress, quoteTokenAddress);

        return order;
    };

    const getContract = async (contract, address) => {
        const w = getWeb3();
        const instance = new w.eth.Contract(contract.abi, address);
        return instance;
    };

    const initBalances = async (token, owner, userAmounts) => {
        for (let j = 0; j < userAmounts.length; j++) {
            const userAddress = userAmounts[j].address;
            const amount = userAmounts[j].amount;

            const userRemain = await token.methods.balanceOf(userAddress).call();
            await token.methods.transfer(owner, userRemain).send({ from: userAddress });
            await token.methods.transfer(userAddress, amount).send({ from: owner });
            await token.methods.approve(proxy._address, infinity).send({ from: userAddress });
        }
    };

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

    const buildBuyLongOrder = async (user, amount, quote) => {
        const orderParam = {
            trader: user,
            relayer,
            version: 2,
            side: 'buy',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: 0,
            asTakerFeeRate: 0,
            baseTokenAmount: toBase(amount),
            quoteTokenAmount: toWei(quote),
            gasTokenAmount: toWei('0.1')
        };
        return await buildOrder(orderParam, longPositionToken._address, collateralToken._address, true);
    }

    const buildSellLongOrder = async (user, amount, quote) => {
        const orderParam = {
            trader: user,
            relayer,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: 0,
            asTakerFeeRate: 0,
            baseTokenAmount: toBase(amount),
            quoteTokenAmount: toWei(quote),
            gasTokenAmount: toWei('0.1')
        };
        return await buildOrder(orderParam, longPositionToken._address, collateralToken._address, true);
    }

    const buildBuyShortOrder = async (user, amount, quote) => {
        const orderParam = {
            trader: user,
            relayer,
            version: 2,
            side: 'buy',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: 0,
            asTakerFeeRate: 0,
            baseTokenAmount: toBase(amount),
            quoteTokenAmount: toWei(quote),
            gasTokenAmount: toWei('0.1')
        };
        return await buildOrder(orderParam, shortPositionToken._address, collateralToken._address, false);
    }

    const buildSellShortOrder = async (user, amount, quote) => {
        const orderParam = {
            trader: user,
            relayer,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: 0,
            asTakerFeeRate: 0,
            baseTokenAmount: toBase(amount),
            quoteTokenAmount: toWei(quote),
            gasTokenAmount: toWei('0.1')
        };
        return await buildOrder(orderParam, shortPositionToken._address, collateralToken._address, false);
    }

    const matchTest = async (matchConfigs) => {
        const takerOrder = await matchConfigs.takerOrder.creator(
            matchConfigs.takerOrder.user,
            matchConfigs.takerOrder.amount,
            matchConfigs.takerOrder.quote,
        );
        await longPositionToken.methods.approve(proxy._address, infinity).send({ from: matchConfigs.takerOrder.user });
        await shortPositionToken.methods.approve(proxy._address, infinity).send({ from: matchConfigs.takerOrder.user });

        let makerOrders = [];
        for (let i = 0; i < matchConfigs.makerOrders.length; i++) {
            const makerOrder = await matchConfigs.makerOrders[i].creator(
                matchConfigs.makerOrders[i].user,
                matchConfigs.makerOrders[i].amount,
                matchConfigs.makerOrders[i].quote,
            );
            await longPositionToken.methods.approve(proxy._address, infinity).send({ from: matchConfigs.makerOrders[i].user });
            await shortPositionToken.methods.approve(proxy._address, infinity).send({ from: matchConfigs.makerOrders[i].user });
            makerOrders.push(makerOrder);
        }

        console.log("==> approve");
        await collateralToken.methods.approve(proxy._address, infinity).send({ from: relayer });
        await longPositionToken.methods.approve(proxy._address, infinity).send({ from: relayer });
        await shortPositionToken.methods.approve(proxy._address, infinity).send({ from: relayer });
        await proxy.methods.approveMarketContractPool(marketContractAddress).send({ from: admin });

        console.log("==> matching")
        await exchange.methods.matchOrders(
            takerOrder,
            makerOrders,
            matchConfigs.filledAmounts,
            matchConfigs.orderAsset
        ).send({ from: relayer, gas: 8000000 });
    }
    /*
    it('buy long + buy short = mint -- single', async () => {
        await initBalances(collateralToken, admin, [
            { address: u1, amount: toWei("10000") },
            { address: u2, amount: toWei("10000") },
        ]);
        const config = {
            takerOrder: {
                creator: buildBuyLongOrder,
                user: u2,
                amount: 1,
                quote: 5000,
            },
            makerOrders: [
                {
                    creator: buildBuyShortOrder,
                    user: u1,
                    amount: 1,
                    quote: 4000,
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

    it('buy long + buy short = mint == multi', async () => {

        console.log(toBase("0.25"));

        await initBalances(collateralToken, admin, [
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
        await initBalances(collateralToken, admin, [
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
    */

    it('buy long + sell long = exchange -- multi', async () => {
        await initBalances(collateralToken, admin, [
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
});
