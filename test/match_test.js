const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getTestContracts, getMarketContract, buildOrder } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

contract('match', async accounts => {
    let exchange, proxy;
    let mpx, ctk, long, short;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    beforeEach(async () => {
        const contracts = await getTestContracts();
        exchange = contracts.exchange;
        proxy = contracts.proxy;

        const mpxContract = await getMarketContract({
            cap: toPrice(8500),
            floor: toPrice(7500),
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContract.mpx;
        ctk = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
    });

    const call = async (method) => {
        return await method.call();
    }

    const send = async (user, method) => {
        const gasLimit = 8000000;
        return await method.send({ from: user, gasLimit: gasLimit });
    }

    const buildMpxOrder = async (config) => {
        const orderParam = {
            trader: config.trader,
            relayer,
            marketContractAddress: mpx._address,
            version: 1,
            side: config.side,
            type: 'limit',
            expiredAtSeconds: typeof (config.expiredAtSeconds) === 'undefined' ? 3500000000 : config.expiredAtSeconds,
            asMakerFeeRate: config.makerFeeRate || '0',
            asTakerFeeRate: config.takerFeeRate || '0',
            amount: config.amount,
            price: config.price,
            gasTokenAmount: config.gasTokenAmount || toWei(0.1),
        };
        return await buildOrder(orderParam);
    };

    const transferBalances = async (initialBalances) => {
        const users = { u1, u2, u3 };
        const tokens = { ctk, long, short };
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
    };

    const getAddressSet = () => {
        return {
            marketContractAddress: mpx._address,
            relayer,
        };
    };

    const newMatchResult = () => {
        return {
            maker: '0x0000000000000000000000000000000000000000',
            taker: '0x0000000000000000000000000000000000000000',
            makerFee: 0,
            takerFee: 0,
            makerGasFee: 0,
            takerGasFee: 0,
            posFilledAmount: 0,
            ctkFilledAmount: 0,
            fillAction: 0,
        };
    };

    it('getOrderContext', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: '0', takerFeeRate: '0', gasTokenAmount: toWei(0.1),
        });
        const context = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const mpxPoolAddress = await call(mpx.methods.COLLATERAL_POOL_ADDRESS());
        assert.equal(context.marketContract, mpx._address, 'marketContract');
        assert.equal(context.marketContractPool, mpxPoolAddress, 'marketContractPool');
        assert.equal(context.ctkAddress, ctk._address, 'ctk');
        assert.equal(context.posAddresses[0], long._address, 'pos[0]');
        assert.equal(context.posAddresses[1], short._address, 'pos[1]');
        assert.equal(context.takerSide, '1', 'takerSide');
    });

    it('getOrderInfo', async () => {
        await transferBalances({
            u1: { ctk: toWei(1.5), long: toBase(1.5), short: toBase(2.5), }
        });
        assert.equal(await call(ctk.methods.balanceOf(u1)), toWei(1.5), 'u1.ctk');
        assert.equal(await call(long.methods.balanceOf(u1)), toBase(1.5), 'u1.long');
        assert.equal(await call(short.methods.balanceOf(u1)), toBase(2.5), 'u1.short');
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: '0', takerFeeRate: '0', gasTokenAmount: toWei(0.1),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const info = await call(exchange.methods.getOrderInfoPublic(
            takerOrder, getAddressSet(), orderContext
        ));
        assert.equal(info.filledAmount, toBase(0), 'filledAmount'); // note: this is a new order, never filled
        assert.equal(info.margins[0], toPrice((7540 - 7500) * 1000), 'margins[0]');
        assert.equal(info.margins[1], toPrice((8500 - 7540) * 1000), 'margins[1]');
        assert.equal(info.balances[0], toBase(1.5), 'balances[0]');
        assert.equal(info.balances[1], toBase(2.5), 'balances[1]');
        assert.notEqual(info.orderHash, '0x0000000000000000000000000000000000000000', 'orderHash');
    });

    it('getOrderInfo FULLY_FILLED', async () => {
        await transferBalances({
            u1: { ctk: toWei(1.5), long: toBase(1.5), short: toBase(2.5), }
        });
        assert.equal(await call(ctk.methods.balanceOf(u1)), toWei(1.5), 'u1.ctk');
        assert.equal(await call(long.methods.balanceOf(u1)), toBase(1.5), 'u1.long');
        assert.equal(await call(short.methods.balanceOf(u1)), toBase(2.5), 'u1.short');
        const takerOrder = await buildMpxOrder({
            trader: u1,
            side: 'sell',
            type: 'limit',
            price: toPrice(7540),
            amount: toBase(0.1),
            relayer,
            marketContractAddress: mpx._address,
            version: 1,
            expiredAtSeconds: 3500000000,
            makerFeeRate: '0',
            takerFeeRate: '0',
            gasTokenAmount: toWei(0.1)
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        try {
            await send(admin, exchange.methods.setFilled(
                takerOrder,
                getAddressSet(),
                toBase(0.1)
            ));
            await call(exchange.methods.getOrderInfoPublic(
                takerOrder, getAddressSet(), orderContext
            ));
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("ORDER_IS_NOT_FILLABLE"), true);
        }
    });

    it('getOrderInfo EXPIRED', async () => {
        await transferBalances({
            u1: { ctk: toWei(1.5), long: toBase(1.5), short: toBase(2.5), }
        });
        assert.equal(await call(ctk.methods.balanceOf(u1)), toWei(1.5), 'u1.ctk');
        assert.equal(await call(long.methods.balanceOf(u1)), toBase(1.5), 'u1.long');
        assert.equal(await call(short.methods.balanceOf(u1)), toBase(2.5), 'u1.short');
        const takerOrder = await buildMpxOrder({
            trader: u1,
            side: 'sell',
            type: 'limit',
            price: toPrice(7540),
            amount: toBase(0.1),
            relayer,
            marketContractAddress: mpx._address,
            version: 1,
            expiredAtSeconds: 0,
            makerFeeRate: '0',
            takerFeeRate: '0',
            gasTokenAmount: toWei(0.1)
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        try {
            await call(exchange.methods.getOrderInfoPublic(
                takerOrder, getAddressSet(), orderContext
            ));
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("ORDER_IS_NOT_FILLABLE"), true);
        }
    });

    it('getOrderInfo CANCELLED', async () => {
        await transferBalances({
            u1: { ctk: toWei(1.5), long: toBase(1.5), short: toBase(2.5), }
        });
        assert.equal(await call(ctk.methods.balanceOf(u1)), toWei(1.5), 'u1.ctk');
        assert.equal(await call(long.methods.balanceOf(u1)), toBase(1.5), 'u1.long');
        assert.equal(await call(short.methods.balanceOf(u1)), toBase(2.5), 'u1.short');
        const takerOrder = await buildMpxOrder({
            trader: u1,
            side: 'sell',
            type: 'limit',
            price: toPrice(7540),
            amount: toBase(0.1),
            relayer,
            marketContractAddress: mpx._address,
            version: 1,
            makerFeeRate: '0',
            takerFeeRate: '0',
            gasTokenAmount: toWei(0.1)
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        try {
            const order = await call(exchange.methods.getOrderFromOrderParamPublic(
                takerOrder,
                getAddressSet()
            ));
            await send(relayer, exchange.methods.cancelOrder(order));
            await call(exchange.methods.getOrderInfoPublic(
                takerOrder, getAddressSet(), orderContext
            ));
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("ORDER_IS_NOT_FILLABLE"), true);
        }
    });

    it('fillMatchResult: buy(long) + buy(short) = mint', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.1),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.2),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const takerInfo = await call(exchange.methods.getOrderInfoPublic(
            takerOrder, getAddressSet(), orderContext
        ));
        const maker1Info = await call(exchange.methods.getOrderInfoPublic(
            makerOrder1, getAddressSet(), orderContext
        ));
        const tmp = await exchange.methods.fillMatchResultPublic(
            newMatchResult(),
            takerOrder, takerInfo,
            makerOrder1, maker1Info,
            orderContext,
            toBase(0.1), // posFilledAmount
        ).call();
        const retFilledAmount = tmp.filledAmount;
        const retResult = tmp.retResult;
        const retTakerOrderInfo = tmp.retTakerOrderInfo;
        const retMakerOrderInfo = tmp.retMakerOrderInfo;

        assert.equal(retFilledAmount, toBase(0.1), 'retFilledAmount');
        assert.equal(retResult.fillAction, 3, 'retResult.fillAction'); // MINT
        assert.equal(retResult.posFilledAmount, toBase(0.1), 'retResult.posFilledAmount');
        assert.equal(retResult.ctkFilledAmount, toWei((7540 - 7500) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
        assert.equal(retTakerOrderInfo.filledAmount, toBase(0.1), 'retTakerOrderInfo.filledAmount');
        assert.equal(retMakerOrderInfo.filledAmount, toBase(0.1), 'retMakerOrderInfo.filledAmount');
    });

    it('getMatchResult: buy(long) + buy(short) = mint', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.2),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.1),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const takerInfo = await call(exchange.methods.getOrderInfoPublic(
            takerOrder, getAddressSet(), orderContext
        ));
        const maker1Info = await call(exchange.methods.getOrderInfoPublic(
            makerOrder1, getAddressSet(), orderContext
        ));
        const tmp = await exchange.methods.getMatchResultPublic(
            takerOrder, takerInfo,
            makerOrder1, maker1Info,
            orderContext,
            toBase(0.1) // posFilledAmount
        ).call();
        const retFilledAmount = tmp.filledAmount;
        const retResult = tmp.result;
        const retTakerOrderInfo = tmp.retTakerOrderInfo;
        const retMakerOrderInfo = tmp.retMakerOrderInfo;

        assert.equal(retFilledAmount, toBase(0.1), 'retFilledAmount');
        assert.equal(retResult.fillAction, 3, 'retResult.fillAction'); // MINT
        assert.equal(retResult.taker, u1, 'retResult.taker');
        assert.equal(retResult.maker, u2, 'retResult.maker');
        assert.equal(retResult.posFilledAmount, toBase(0.1), 'retResult.posFilledAmount');
        assert.equal(retResult.ctkFilledAmount, toWei((7540 - 7500) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
        assert.equal(retResult.makerFee, toWei(8000 * 0.1 * 0.00100), 'retResult.makerFee');
        assert.equal(retResult.takerFee, toWei(8000 * 0.1 * 0.00300), 'retResult.takerFee');
        assert.equal(retResult.makerGasFee, toWei(0.1), 'retResult.makerGasFee');
        assert.equal(retResult.takerGasFee, toWei(0.2), 'retResult.takerGasFee');
        assert.equal(retTakerOrderInfo.balances[1], toBase(0.1), 'retTakerOrderInfo.balances[1]');
        assert.equal(retMakerOrderInfo.balances[0], toBase(0.1), 'retMakerOrderInfo.balances[0]');
    });

    it('fillMatchResult: sell(long) + sell(short) = redeem', async () => {
        await transferBalances({
            u1: { long: toBase(0.1) },
            u2: { short: toBase(0.1) },
        });
        const takerOrder = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.1),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.2),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const takerInfo = await call(exchange.methods.getOrderInfoPublic(
            takerOrder, getAddressSet(), orderContext
        ));
        const maker1Info = await call(exchange.methods.getOrderInfoPublic(
            makerOrder1, getAddressSet(), orderContext
        ));
        const tmp = await exchange.methods.fillMatchResultPublic(
            newMatchResult(),
            takerOrder, takerInfo,
            makerOrder1, maker1Info,
            orderContext,
            toBase(0.1), // posFilledAmount
        ).call();
        const retFilledAmount = tmp.filledAmount;
        const retResult = tmp.retResult;
        const retTakerOrderInfo = tmp.retTakerOrderInfo;
        const retMakerOrderInfo = tmp.retMakerOrderInfo;

        assert.equal(retFilledAmount, toBase(0.1), 'retFilledAmount');
        assert.equal(retResult.fillAction, 4, 'retResult.fillAction'); // REDEEM
        assert.equal(retResult.posFilledAmount, toBase(0.1), 'retResult.posFilledAmount');
        assert.equal(retResult.ctkFilledAmount, toWei((7540 - 7500) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
        assert.equal(retTakerOrderInfo.filledAmount, toBase(0.1), 'retTakerOrderInfo.filledAmount');
        assert.equal(retMakerOrderInfo.filledAmount, toBase(0.1), 'retMakerOrderInfo.filledAmount');
    });

    it('getMatchResult: sell(long) + sell(short) = redeem', async () => {
        await transferBalances({
            u1: { long: toBase(0.1) },
            u2: { short: toBase(0.1) },
        });
        const takerOrder = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.2),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasTokenAmount: toWei(0.1),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const takerInfo = await call(exchange.methods.getOrderInfoPublic(
            takerOrder, getAddressSet(), orderContext
        ));
        const maker1Info = await call(exchange.methods.getOrderInfoPublic(
            makerOrder1, getAddressSet(), orderContext
        ));
        const tmp = await exchange.methods.getMatchResultPublic(
            takerOrder, takerInfo,
            makerOrder1, maker1Info,
            orderContext,
            toBase(0.1) // posFilledAmount
        ).call();
        const retFilledAmount = tmp.filledAmount;
        const retResult = tmp.result;
        const retTakerOrderInfo = tmp.retTakerOrderInfo;
        const retMakerOrderInfo = tmp.retMakerOrderInfo;

        assert.equal(retFilledAmount, toBase(0.1), 'retFilledAmount');
        assert.equal(retResult.fillAction, 4, 'retResult.fillAction'); // REDEEM
        assert.equal(retResult.taker, u2, 'retResult.taker');
        assert.equal(retResult.maker, u1, 'retResult.maker');
        assert.equal(retResult.posFilledAmount, toBase(0.1), 'retResult.posFilledAmount');
        assert.equal(retResult.ctkFilledAmount, toWei((7540 - 7500) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
        assert.equal(retResult.makerFee, toWei(8000 * 0.1 * 0.00100), 'retResult.makerFee');
        assert.equal(retResult.takerFee, toWei(8000 * 0.1 * 0.00300), 'retResult.takerFee');
        assert.equal(retResult.makerGasFee, toWei(0.1), 'retResult.makerGasFee');
        assert.equal(retResult.takerGasFee, toWei(0.2), 'retResult.takerGasFee');
        assert.equal(retTakerOrderInfo.balances[1], toBase(0), 'retTakerOrderInfo.balances[1]');
        assert.equal(retMakerOrderInfo.balances[0], toBase(0), 'retMakerOrderInfo.balances[0]');

        assert.equal(await call(ctk.methods.balanceOf(u1)), toBase(0), 'u1.ctk');
        assert.equal(await call(ctk.methods.balanceOf(u2)), toBase(0), 'u2.ctk');
        const ctkFromProxyToTaker = await call(exchange.methods.doRedeemPublic(
            retResult, getAddressSet(), orderContext
        ));
        assert.equal(ctkFromProxyToTaker, toWei((8500 - 7540) * 0.1, -8000 * 0.1 * 0.00300, -0.2), 'u2.ctk'); // taker ctk
        await send(relayer, exchange.methods.doRedeemPublic(
            retResult, getAddressSet(), orderContext
        ));
        assert.equal(await call(ctk.methods.balanceOf(u1)), toWei((7540 - 7500) * 0.1, -8000 * 0.1 * 0.00100, -0.1), 'u1.ctk'); // maker ctk
    });

    it('sell(short) + [buy(short) + sell(long)] = exchange + redeem', async () => {
        await transferBalances({
            u1: { short: toBase(1) },
            u2: { ctk: toWei(10000) },
            u3: { long: toBase(1) },
        });
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'buy', type: 'limit', price: toPrice(8000), amount: toBase(1),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 250, takerFeeRate: 250, gasTokenAmount: toWei(0.2),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u2, side: 'sell', type: 'limit', price: toPrice(7900), amount: toBase(0.5),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 250, takerFeeRate: 250, gasTokenAmount: toWei(0.1),
        });
        const makerOrder2 = await buildMpxOrder({
            trader: u3, side: 'sell', type: 'limit', price: toPrice(7980), amount: toBase(0.5),
            relayer, marketContractAddress: mpx._address, version: 1, expiredAtSeconds: 3500000000,
            makerFeeRate: 250, takerFeeRate: 250, gasTokenAmount: toWei(0.1),
        });
        const orderContext = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const retResults = await exchange.methods.getMatchPlanPublic(
            takerOrder, [makerOrder1, makerOrder2],
            [toBase(0.5), toBase(0.5),], // posFilledAmount
            getAddressSet(), orderContext
        ).call();
        assert.equal(retResults.length, 6, 'results.length');
        assert.equal(retResults[0].fillAction, 2, 'results[0].fillAction'); // SELL
        assert.equal(retResults[1].fillAction, 4, 'results[1].fillAction'); // REDEEM
        assert.equal(retResults[2].fillAction, 0, 'results[2].fillAction'); // INVALID
        assert.equal(retResults[3].fillAction, 0, 'results[3].fillAction'); // INVALID
        assert.equal(retResults[0].posFilledAmount, toBase(0.5), 'results[0].posFilledAmount');
        assert.equal(retResults[1].posFilledAmount, toBase(0.5), 'results[1].posFilledAmount');
        assert.equal(retResults[0].maker, u2, 'results[0].maker');
        assert.equal(retResults[1].maker, u3, 'results[1].maker');
        assert.equal(retResults[0].ctkFilledAmount, toWei(300), 'results[0].ctkFilledAmount');
        assert.equal(retResults[1].ctkFilledAmount, toWei(240), 'results[1].ctkFilledAmount');
    });
});
