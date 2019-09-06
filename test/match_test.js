const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getTestContracts, getMarketContract, buildOrder } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');

const prices = new BigNumber('10000000000');
const bases = new BigNumber('100000');
const weis = new BigNumber('1000000000000000000');

const toPrice = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(prices));
    }
    return sum.toFixed();
}

const fromPrice = x => {
    return new BigNumber(x).div(prices).toString();
}

const toBase = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(bases));
    }
    return sum.toFixed();
}

const fromBase = x => {
    return new BigNumber(x).div(bases).toString();
}

const toWei = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(weis));
    }
    return sum.toFixed();
};

const fromWei = x => {
    return new BigNumber(x).div(weis).toString();
};

const infinity = '999999999999999999999999999999999999999999';

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
            marketContract: mpx._address,
            version: 2,
            side: config.side,
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: config.makerFeeRate || '0',
            asTakerFeeRate: config.takerFeeRate || '0',
            amount: config.amount,
            price: config.price,
            gasAmount: config.gasAmount || toWei(0.1),
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
            marketContract: mpx._address,
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
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: '0', takerFeeRate: '0', gasAmount: toWei(0.1),
        });
        const context = await call(exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder));
        const mpxPoolAddress = await call(mpx.methods.COLLATERAL_POOL_ADDRESS());
        assert.equal(context.marketContract, mpx._address, 'marketContract');
        assert.equal(context.marketContractPool, mpxPoolAddress, 'marketContractPool');
        assert.equal(context.ctk, ctk._address, 'ctk');
        assert.equal(context.pos[0], long._address, 'pos[0]');
        assert.equal(context.pos[1], short._address, 'pos[1]');
        assert.equal(context.takerSide, '1', 'takerSide');
    });

    it('getOrderInfo', async () => {
        await transferBalances({
            u1: { ctk: toWei(1.5), long: toBase(1.5), short: toBase(2.5), }
        });
        assert.equal(toWei(1.5), await call(ctk.methods.balanceOf(u1)), 'u1.ctk');
        assert.equal(toBase(1.5), await call(long.methods.balanceOf(u1)), 'u1.long');
        assert.equal(toBase(2.5), await call(short.methods.balanceOf(u1)), 'u1.short');
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: '0', takerFeeRate: '0', gasAmount: toWei(0.1),
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

    it('fillMatchResult: buy(long) + buy(short) = mint', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.1),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.2),
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
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.2),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u2, side: 'buy', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.1),
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
            toBase(0.1), // posFilledAmount
            300, // takerFeeRate
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
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.1),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.2),
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
        assert.equal(retResult.ctkFilledAmount, toWei((8500 - 7540) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
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
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.2),
        });
        const makerOrder1 = await buildMpxOrder({
            trader: u1, side: 'sell', type: 'limit', price: toPrice(7540), amount: toBase(0.1),
            relayer, marketContract: mpx._address, version: 2, expiredAtSeconds: 3500000000,
            makerFeeRate: 100, takerFeeRate: 300, gasAmount: toWei(0.1),
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
            toBase(0.1), // posFilledAmount
            300, // takerFeeRate
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
        assert.equal(retResult.ctkFilledAmount, toWei((8500 - 7540) * 0.1), 'retResult.ctkFilledAmount'); // maker margin
        assert.equal(retResult.makerFee, toWei(8000 * 0.1 * 0.00100), 'retResult.makerFee');
        assert.equal(retResult.takerFee, toWei(8000 * 0.1 * 0.00300), 'retResult.takerFee');
        assert.equal(retResult.makerGasFee, toWei(0.1), 'retResult.makerGasFee');
        assert.equal(retResult.takerGasFee, toWei(0.2), 'retResult.takerGasFee');
        assert.equal(retTakerOrderInfo.balances[1], toBase(0), 'retTakerOrderInfo.balances[1]');
        assert.equal(retMakerOrderInfo.balances[0], toBase(0), 'retMakerOrderInfo.balances[0]');

        assert.equal(toBase(0), await call(ctk.methods.balanceOf(u1)), 'u1.ctk');
        assert.equal(toBase(0), await call(ctk.methods.balanceOf(u2)), 'u2.ctk');
        const ctkFromProxyToTaker = await call(exchange.methods.doRedeemPublic(
            retResult, getAddressSet(), orderContext
        ));
        assert.equal(toWei((7540 - 7500) * 0.1, -8000 * 0.1 * 0.00300, -0.2, ), ctkFromProxyToTaker, 'u2.ctk'); // taker ctk
        await send(relayer, exchange.methods.doRedeemPublic(
            retResult, getAddressSet(), orderContext
        ));
        assert.equal(toWei((8500 - 7540) * 0.1, -8000 * 0.1 * 0.00100, -0.1), await call(ctk.methods.balanceOf(u1)), 'u1.ctk'); // maker ctk
    });
});
