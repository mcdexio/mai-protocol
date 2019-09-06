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
    let mpx, mpxPool, collateral, long, short;

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
        mpxPool = await mpx.methods.COLLATERAL_POOL_ADDRESS().call();
        collateral = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
    });

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

    it('getOrderContext', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1,
            relayer,
            marketContract: mpx._address,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: '0',
            asTakerFeeRate: '0',
            amount: toBase(0.1),
            price: toPrice(7500),
            gasAmount: toWei(0.1),
        });
        const context = await exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder);
        console.log('??1', context);
    });

    it('getOrderInfo', async () => {
        const takerOrder = await buildMpxOrder({
            trader: u1,
            relayer,
            marketContract: mpx._address,
            version: 2,
            side: 'sell',
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: '0',
            asTakerFeeRate: '0',
            amount: toBase(0.1),
            price: toPrice(7500),
            gasAmount: toWei(0.1),
        });
        const orderContext = await exchange.methods.getOrderContextPublic(getAddressSet(), takerOrder);
        const info = await exchange.methods.getOrderInfoPublic(order).call(
            takerOrder, getAddressSet(), orderContext
        );
        console.log('>>2', info)

    });

    it('buy(long) + buy(short) = mint', async () => {
        // const actural = await exchange.methods.getMatchResultPublic(
        //     // takerOrderParam
        //     { trader: u2, amount: toBase(0.1), price: toPrice(7500 + 40), gasAmount: 0,
        //       data: '0x0000000000000000000000000000000000000000'
                     
        //     },
        //     // takerOrderInfo
        //     { orderHash: '0xa1', filledAmount: toBase(0.1),
        //       margins: [toPrice(40 * 1000), toPrice(60 * 1000) ],
        //       balances: [toBase(0), toBase(0), ],
        //     },
        //     // makerOrderParam
        //     { trader: u1, amount: toBase(0.1), price: toPrice(7500 + 40), gasAmount: 0, },
        //     // makerOrderInfo
        //     { orderHash: 'a2', filledAmount: toBase(0.1),
        //       margins: [toPrice(40 * 1000), toPrice(60 * 1000) ],
        //       balances: [toBase(0), toBase(0), ],
        //     },
        //     // orderContext
        //     { marketContract: mpx._address, marketContractPool: mpxPool._address,
        //       ctk: collateral._address, pos: [ long._address, short._address ],
        //       takerSide: 0 // 0 = buy, 1 = short
        //     },
        //     // posFilledAmount
        //     toBase(0.1),
        //     // takerFeeRate
        //     toWei(250),
        // ).call();
        // console.log(actural);
    });

});
