const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getTestContracts, getMarketContract } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { fromRpcSig } = require('ethereumjs-util');

const bases = new BigNumber('100000');
const weis = new BigNumber('1000000000000000000');

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

contract('Match', async accounts => {
    let exchange, proxy;
    let mpx, collateral, long, short;

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
            cap: 8500e10,
            floor: 7500e10,
            multiplier: 1000,
            feeRate: 300,
        });

        mpx = mpxContract.mpx;
        collateral = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
    });

    const getOrderSignature = async (order) => {
        const orderHash = getOrderHash(order);
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

    const buildOrder = async (orderParam) => {
        const order = {
            trader: orderParam.trader,
            relayer: orderParam.relayer,
            marketContract: orderParam.marketContract,
            amount: orderParam.amount,
            price: orderParam.price,
            gasAmount: orderParam.gasAmount,
            data: generateOrderData(
                orderParam.version,
                orderParam.side === 'sell',
                orderParam.type === 'market',
                orderParam.expiredAtSeconds,
                orderParam.asMakerFeeRate,
                orderParam.asTakerFeeRate,
                orderParam.makerRebateRate || '0',
                Math.round(10000000),
                false,
            ),
        };

        await getOrderSignature(order);

        return order;
    };

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
    }

    const gasLimit = 8000000;

    const call = async (method) => {
        return await method.call();
    }
    const send = async (user, method) => {
        return await method.send({ from: user, gasLimit: gasLimit });
    }
    const except = async (user, method) => {
        return await method.send({ from: user, gasLimit: gasLimit }).catch(res => { return res.message});
    }

    const FillActions = Object.freeze({
        INVALID: 0,
        BUY: 1,
        SELL: 2,
        MINT: 3,
        REDEEM: 4,
    });

    contract('transferPublic', async accounts => {

        it('should transfer erc20 tokens without approve', async () => {
            const amount = new BigNumber(11001e18);
            await send(admin, collateral.methods.mint(proxy._address, amount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u1)), 0);

            const toTransfer = new BigNumber(288e18);
            await send(relayer, exchange.methods.transferPublic(collateral._address, u1, toTransfer.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.minus(toTransfer).toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u1)), toTransfer.toFixed());
        });

        it('should fail on low funds', async () => {
            const amount = new BigNumber(2e18);
            await send(admin, collateral.methods.mint(proxy._address, amount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u1)), 0);

            const toTransfer = new BigNumber(3e18);

            const hasException = await exchange.methods.transferPublic(collateral._address, u1, toTransfer.toFixed())
                .send({ from: relayer, gasLimit: gasLimit })
                .catch(res => {
                    return res.message.includes("TRANSFER_FAILED");
                });

            assert.equal(hasException, true);
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u1)), 0);
        });
    });

    contract('transferFromPublic', async accounts => {

        it('should fail to transfer erc20 tokens without approve', async () => {
            const amount = new BigNumber(1001e18);

            await send(admin, collateral.methods.mint(u1, amount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);

            const toTransfer = new BigNumber(288e18);
            const hasException = await exchange.methods.transferFromPublic(collateral._address, u1, u2, toTransfer.toFixed())
                .send({ from: relayer, gasLimit: gasLimit })
                .catch(res => {
                    return res.message.includes("TRANSFER_FROM_FAILED");
                });

            assert.equal(hasException, true);
            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);
        });

        it('should fail to transfer erc20 tokens with approve', async () => {
            const amount = new BigNumber(1001e18);

            await send(admin, collateral.methods.mint(u1, amount.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));

            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);

            const toTransfer = new BigNumber(288e18);
            await send(relayer, exchange.methods.transferFromPublic(collateral._address, u1, u2, toTransfer.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.minus(toTransfer).toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), toTransfer.toFixed());
        });

        it('should fail on low funds', async () => {
            const amount = new BigNumber(1001e18);

            await send(admin, collateral.methods.mint(u1, amount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);

            const toTransfer = new BigNumber(1288e18);
            const hasException = await exchange.methods.transferFromPublic(collateral._address, u1, u2, toTransfer.toFixed())
                .send({ from: relayer, gasLimit: gasLimit })
                .catch(res => {
                    return res.message.includes("TRANSFER_FROM_FAILED");
                });

            assert.equal(hasException, true);
            assert.equal(await call(collateral.methods.balanceOf(u1)), amount.toFixed());
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);
        });
    });

    contract('mintPositionTokensPublic', async accounts => {
        it('should fail to mint position token without approve', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(proxy._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);

            const message = await except(relayer, exchange.methods.mintPositionTokensPublic(mpx._address, toBase(1)));
            assert.equal(message.includes("MINT_FAILED"), true);

        });

        it('should fail to mint position token without sufficient collateral', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(proxy._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            const message = await except(relayer, exchange.methods.mintPositionTokensPublic(mpx._address, toBase(10)));
            assert.equal(message.includes("MINT_FAILED"), true);

        });

        it('should mint position tokens', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(proxy._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));

            const posAmount = new BigNumber(toBase(1));
            await send(relayer, exchange.methods.mintPositionTokensPublic(mpx._address, posAmount.toFixed()));

            const posCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .plus(new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))).times(posAmount);

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), amount.minus(posCost).toFixed());
            assert.equal(await call(long.methods.balanceOf(proxy._address)), posAmount.toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), posAmount.toFixed());
        });
    });

    contract('redeemPositionTokensPublic', async accounts => {
        it('should redeem position token without approve', async () => {
            const posAmount = new BigNumber(toBase(1));
            const posValue = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(posAmount);


            await send(admin, long.methods.mint(proxy._address, posAmount.toFixed()));
            await send(admin, short.methods.mint(proxy._address, posAmount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), posAmount.toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), posAmount.toFixed());

            await send(relayer, exchange.methods.redeemPositionTokensPublic(mpx._address, posAmount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), posValue.toFixed());
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
        });
    });

    contract('doMintPublic', async accounts => {

        it('should mint position token', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(600));
            const toMintAmount = new BigNumber(toBase(1));
            const fee = new BigNumber(toWei(15));
            const gasFee = new BigNumber(toWei(0.1));
            const mintCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toMintAmount);
            const mintFee = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))
            .times(toMintAmount);


            const result = {
                maker: u1,
                taker: u2,
                makerFee: fee.toFixed(),
                takerFee: fee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toMintAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.MINT,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toMintAmount.toFixed());

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), fee.plus(fee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });

        it('should mint position token too', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(600));
            const toMintAmount = new BigNumber(toBase(1));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(15));
            const gasFee = new BigNumber(toWei(0.1));
            const mintCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toMintAmount);
            const mintFee = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))
            .times(toMintAmount);


            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toMintAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.MINT,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toMintAmount.toFixed());

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });

        it('should mint position token, reversed', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(600));
            const toMintAmount = new BigNumber(toBase(1));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(15));
            const gasFee = new BigNumber(toWei(0.1));
            const mintCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toMintAmount);
            const mintFee = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))
            .times(toMintAmount);


            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toMintAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.MINT,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 1,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), toMintAmount.toFixed());

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });

        it('should fail to mint on low funds', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(600));
            const toMintAmount = new BigNumber(toBase(1));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(13));
            const gasFee = new BigNumber(toWei(0.1));
            const mintCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toMintAmount);
            const mintFee = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))
            .times(toMintAmount);


            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toMintAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.MINT,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            const message = await except(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));
            assert.equal(message.includes("INSUFFICIENT_FEE"), true);

        });
    });

    contract('doBuyPublic', async accounts => {
        it('should buy long positon token from maker', async () => {

            const toBuy = new BigNumber(toBase(0.9));
            await send(admin, long.methods.mint(u1, toBuy.toFixed()));
            await send(u1, long.methods.approve(proxy._address, infinity));

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(13));
            const gasFee = new BigNumber(toWei(0.1));

            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toBuy.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.BUY,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(relayer, exchange.methods.doBuyPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), makerMargin.minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(makerMargin).plus(makerFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toBuy.toFixed());

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);

        });

        it('should buy short positon token from maker', async () => {

            const toBuy = new BigNumber(toBase(0.9));
            await send(admin, short.methods.mint(u1, toBuy.toFixed()));
            await send(u1, short.methods.approve(proxy._address, infinity));

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u2, collateral.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(13));
            const gasFee = new BigNumber(toWei(0.1));

            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toBuy.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.BUY,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 1,
            };

            await send(relayer, exchange.methods.doBuyPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), makerMargin.minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(makerMargin).plus(makerFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), toBuy.toFixed());
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });
    });

    contract('doRedeemPublic', async accounts => {
        it('should redeem collateral from mpx', async () => {
            const initalPos = new BigNumber(toBase(1));
            await send(admin, long.methods.mint(u1, initalPos.toFixed()));
            await send(u1, long.methods.approve(proxy._address, infinity));
            await send(admin, short.methods.mint(u2, initalPos.toFixed()));
            await send(u2, short.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(400));
            const toRedeemAmount = new BigNumber(toBase(1));
            const fee = new BigNumber(toWei(15));
            const gasFee = new BigNumber(toWei(0.1));
            const redeemGain = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toRedeemAmount);

            const result = {
                maker: u1,
                taker: u2,
                makerFee: fee.toFixed(),
                takerFee: fee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toRedeemAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.REDEEM,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            await send(relayer, exchange.methods.doRedeemPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), makerMargin.minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), redeemGain.minus(makerMargin).plus(fee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });

        it('should fail to redeem collateral from mpx', async () => {
            const initalPos = new BigNumber(toBase(1));
            const initalPos2 = new BigNumber(toBase(0.5));
            await send(admin, long.methods.mint(u1, initalPos.toFixed()));
            await send(u1, long.methods.approve(proxy._address, infinity));
            await send(admin, short.methods.mint(u2, initalPos2.toFixed()));
            await send(u2, short.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(400));
            const toRedeemAmount = new BigNumber(toBase(1));
            const fee = new BigNumber(toWei(15));
            const gasFee = new BigNumber(toWei(0.1));
            const redeemGain = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .times(toRedeemAmount);

            const result = {
                maker: u1,
                taker: u2,
                makerFee: fee.toFixed(),
                takerFee: fee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toRedeemAmount.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.REDEEM,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(admin, proxy.methods.approveMarketContractPool(mpx._address));
            const message = await except(relayer, exchange.methods.doRedeemPublic(result, orderAddressSet, orderContext));

            assert.equal(message.includes("TRANSFER_FROM_FAILED"), true);
        });
    });

    contract('doSellPublic', async accounts => {
        it('should sell long positon token to maker', async () => {

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));

            const toSell = new BigNumber(toBase(0.9));
            await send(admin, long.methods.mint(u2, toSell.toFixed()));
            await send(u2, long.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(13));
            const gasFee = new BigNumber(toWei(0.1));

            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toSell.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.SELL,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 1,
            };

            await send(relayer, exchange.methods.doSellPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), toSell.toFixed());

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerMargin.plus(makerFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);

        });

        it('should sell short positon token to maker', async () => {

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(proxy._address, infinity));

            const toSell = new BigNumber(toBase(0.9));
            await send(admin, short.methods.mint(u2, toSell.toFixed()));
            await send(u2, short.methods.approve(proxy._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const makerFee = new BigNumber(toWei(10));
            const takerFee = new BigNumber(toWei(13));
            const gasFee = new BigNumber(toWei(0.1));

            const result = {
                maker: u1,
                taker: u2,
                makerFee: makerFee.toFixed(),
                takerFee: takerFee.toFixed(),
                makerGasFee: gasFee.toFixed(),
                takerGasFee: gasFee.toFixed(),
                posFilledAmount: toSell.toFixed(),
                ctkFilledAmount: makerMargin.toFixed(),
                fillAction: FillActions.SELL,
            };
            const orderAddressSet = {
                marketContract: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketContractPool: mpx._address,
                ctk: collateral._address,
                pos: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(relayer, exchange.methods.doSellPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), toSell.toFixed());
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), 0);
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerMargin.plus(makerFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);

            // proxy
            assert.equal(await call(collateral.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(short.methods.balanceOf(proxy._address)), 0);
            assert.equal(await call(long.methods.balanceOf(proxy._address)), 0);
        });
    });
});
