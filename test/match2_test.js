const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getTestContracts, getMarketContract } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { toBase, fromBase, toWei, fromWei, infinity } = require('./utils');
const { shouldFailOnError } = require('./utils');
const { fromRpcSig } = require('ethereumjs-util');

contract('Match2', async accounts => {
    let exchange;
    let mpx, collateral, long, short;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    let orderContext;

    beforeEach(async () => {
        const contracts = await getTestContracts();
        exchange = contracts.exchange;

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

        orderContext = {
            marketContract: mpx._address,
            marketCollateralPool: mpx._address,
            collateral: collateral._address,
            positions: [
                long._address,
                short._address
            ],
            takerSide: 0,
        };
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
            marketContractAddress: orderParam.marketContractAddress,
            amount: orderParam.amount,
            price: orderParam.price,
            gasTokenAmount: orderParam.gasTokenAmount,
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

    const gasLimit = 8000000;

    const call = async (method) => {
        return await method.call();
    }
    const send = async (user, method) => {
        return await method.send({ from: user, gasLimit: gasLimit });
    }

    const FillActions = Object.freeze({
        INVALID: 0,
        BUY: 1,
        SELL: 2,
        MINT: 3,
        REDEEM: 4,
    });

    contract('validateMarketContractPublic', async () => {
        it('should fail if contract not in whitelist', async () => {
            await exchange.methods.setMarketRegistryAddress(mpx._address)
                .send({ from: admin });
            try {
                await exchange.methods.validateMarketContractPublic("0x0000000000000000000000000000000000000512").call();
                throw null;
            } catch (error) {
                assert.equal(error.message.includes("INVALID_MARKET_CONTRACT"), true);
                return;
            }
        });

        it('should success if registry disabled', async () => {
            await exchange.methods.setMarketRegistryAddress("0x0000000000000000000000000000000000000000").send({ from: admin });
            await exchange.methods.validateMarketContractPublic("0x0000000000000000000000000000000000000512").call();
        });

        it('should success', async () => {
            await mpx.methods.addAddressToWhiteList("0x0000000000000000000000000000000000001024").send({ from: admin });
            await exchange.methods.setMarketRegistryAddress(mpx._address).send({ from: admin });
            await exchange.methods.validateMarketContractPublic("0x0000000000000000000000000000000000001024").call();
        });
    });

    contract('mintPositionTokensPublic', async accounts => {

        it('should fail to mint position token without approve', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(exchange._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            await shouldFailOnError(
                "revert",
                async () => {
                    await exchange.methods.mintPositionTokensPublic(orderContext, toBase(1))
                        .send({ from: relayer, gasLimit: gasLimit })
                }
            );
        });

        it('should fail to mint position token without sufficient collateral', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(exchange._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await shouldFailOnError(
                "revert",
                async () => {
                    await exchange.methods.mintPositionTokensPublic(orderContext, toBase(10))
                        .send({ from: relayer, gasLimit: gasLimit })
                }
            );
        });

        it('should mint position tokens', async () => {
            const amount = new BigNumber(1234e18);

            await send(admin, collateral.methods.mint(exchange._address, amount.toFixed()));
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), amount.toFixed());
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));

            const posAmount = new BigNumber(toBase(1));
            await send(relayer, exchange.methods.mintPositionTokensPublic(orderContext, posAmount.toFixed()));

            const posCost = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT()))
                .plus(new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT()))).times(posAmount);

            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), amount.minus(posCost).toFixed());
            assert.equal(await call(long.methods.balanceOf(exchange._address)), posAmount.toFixed());
            assert.equal(await call(short.methods.balanceOf(exchange._address)), posAmount.toFixed());
        });

        it('should mint 0 position tokens', async () => {
            await send(relayer, exchange.methods.mintPositionTokensPublic(orderContext, 0));
        });
    });

    contract('redeemPositionTokensPublic', async accounts => {
        it('should redeem position token without approve', async () => {
            const posAmount = new BigNumber(toBase(1));
            const posValue = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(posAmount);

            await send(admin, long.methods.mint(exchange._address, posAmount.toFixed()));
            await send(admin, short.methods.mint(exchange._address, posAmount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), posAmount.toFixed());
            assert.equal(await call(short.methods.balanceOf(exchange._address)), posAmount.toFixed());

            await send(relayer, exchange.methods.redeemPositionTokensPublic(orderContext, posAmount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), posValue.toFixed());
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
        });

        it('should fail to redeem position token without sufficient position token', async () => {
            const posAmount = new BigNumber(toBase(1));
            const posValue = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(posAmount);

            await send(admin, long.methods.mint(exchange._address, posAmount.toFixed()));
            await send(admin, short.methods.mint(exchange._address, posAmount.toFixed()));

            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), posAmount.toFixed());
            assert.equal(await call(short.methods.balanceOf(exchange._address)), posAmount.toFixed());

            try {
                await send(relayer, exchange.methods.redeemPositionTokensPublic(orderContext, toBase(1.1)));
                throw null;
            } catch (error) {
                assert.equal(error.message.includes("revert"), true);
            }
        });

        it('should redeem 0 position token', async () => {
            await send(relayer, exchange.methods.redeemPositionTokensPublic(orderContext, 0));
        });
    });

    contract('doMintPublic', async accounts => {
        it('should mint position token', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toMintAmount.toFixed());

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), fee.plus(fee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);
        });

        it('should mint position token too', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toMintAmount.toFixed());

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);
        });

        it('should mint position token, reversed', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 1,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await send(relayer, exchange.methods.doMintPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), toMintAmount.toFixed());

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(mintCost.minus(makerMargin)).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), toMintAmount.toFixed());
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).minus(mintFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);
        });

        it('should fail to mint on low fee rate', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await shouldFailOnError(
                "low-level call failed",
                async () => {
                    await exchange.methods.doMintPublic(result, orderAddressSet, orderContext)
                        .send({ from: relayer, gasLimit: gasLimit })
                }
            );
        });

        it('should fail to mint on low funds ', async () => {
            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

            const makerMargin = new BigNumber(toWei(500));
            const takerMargin = new BigNumber(toWei(500));
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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            const ctkRequired = new BigNumber(await call(mpx.methods.COLLATERAL_PER_UNIT())).times(toMintAmount);
            const ctkFeeRequired = new BigNumber(await call(mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT())).times(toMintAmount);
            assert.equal(ctkRequired.plus(ctkFeeRequired).toFixed(), toWei(1024));

            await send(admin, exchange.methods.approveERC20(collateral._address, mpx._address, infinity));
            await shouldFailOnError(
                "low-level call failed",
                async () => {
                    await exchange.methods.doMintPublic(result, orderAddressSet, orderContext)
                        .send({ from: relayer, gasLimit: gasLimit })
                }
            );
        });
    });

    contract('doBuyPublic', async accounts => {
        it('should buy long positon token from maker', async () => {

            const toBuy = new BigNumber(toBase(0.9));
            await send(admin, long.methods.mint(u1, toBuy.toFixed()));
            await send(u1, long.methods.approve(exchange._address, infinity));
            await send(u1, collateral.methods.approve(exchange._address, infinity));

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
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
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(makerMargin).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), toBuy.toFixed());

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);

        });

        it('should buy short positon token from maker', async () => {

            const toBuy = new BigNumber(toBase(0.9));
            await send(admin, short.methods.mint(u1, toBuy.toFixed()));
            await send(u1, short.methods.approve(exchange._address, infinity));
            await send(u1, collateral.methods.approve(exchange._address, infinity));

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u2, initalBalance.toFixed()));
            await send(u2, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
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
            assert.equal(await call(collateral.methods.balanceOf(u2)), initalBalance.minus(makerMargin).minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), toBuy.toFixed());
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);
        });
    });

    contract('doRedeemPublic', async accounts => {
        it('should redeem collateral from mpx', async () => {
            const initalPos = new BigNumber(toBase(1));
            await send(admin, long.methods.mint(u1, initalPos.toFixed()));
            await send(u1, long.methods.approve(exchange._address, infinity));
            await send(admin, short.methods.mint(u2, initalPos.toFixed()));
            await send(u2, short.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(admin, exchange.methods.approveERC20(long._address, mpx._address, infinity));
            await send(admin, exchange.methods.approveERC20(short._address, mpx._address, infinity));
            await send(relayer, exchange.methods.doRedeemPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), makerMargin.minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), 0);

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), redeemGain.minus(makerMargin).minus(fee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), fee.plus(fee).plus(gasFee).plus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);
        });

        it('should fail to redeem collateral from mpx', async () => {
            const initalPos = new BigNumber(toBase(1));
            const initalPos2 = new BigNumber(toBase(0.5));
            await send(admin, long.methods.mint(u1, initalPos.toFixed()));
            await send(u1, long.methods.approve(exchange._address, infinity));
            await send(admin, short.methods.mint(u2, initalPos2.toFixed()));
            await send(u2, short.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 0,
            };

            await send(admin, exchange.methods.approveERC20(long._address, mpx._address, infinity));
            await send(admin, exchange.methods.approveERC20(short._address, mpx._address, infinity));
            await shouldFailOnError(
                "low-level call failed",
                async () => {
                    await exchange.methods.doRedeemPublic(result, orderAddressSet, orderContext)
                        .send({ from: relayer, gasLimit: gasLimit })
                }
            );
        });
    });

    contract('validatePricePublic', async accounts => {
        it('should success', async () => {
            const makerOrder = await buildOrder({
                trader: u1,
                relayer,
                marketContractAddress: mpx._address,
                version: 1,
                side: "buy",
                type: 'limit',
                expiredAtSeconds: 3500000000,
                asMakerFeeRate: 150,
                asTakerFeeRate: 0,
                amount: toBase(1),
                price: toBase(8000),
                gasTokenAmount: toWei(0.1),
            });
            const takerOrder = await buildOrder({
                trader: u2,
                relayer,
                marketContractAddress: mpx._address,
                version: 1,
                side: 'sell',
                type: 'limit',
                expiredAtSeconds: 3500000000,
                asMakerFeeRate: 0,
                asTakerFeeRate: 150,
                amount: toBase(1),
                price: toBase(8000),
                gasTokenAmount: toWei(0.1),
            });
            await send(relayer, exchange.methods.validatePricePublic(takerOrder, makerOrder));
        });
    });

    contract('doSellPublic', async accounts => {
        it('should sell long positon token to maker', async () => {

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));

            const toSell = new BigNumber(toBase(0.9));
            await send(admin, long.methods.mint(u2, toSell.toFixed()));
            await send(u2, long.methods.approve(exchange._address, infinity));

            await send(relayer, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
                    long._address,
                    short._address
                ],
                takerSide: 1, // short
            };

            await send(relayer, exchange.methods.doSellPublic(result, orderAddressSet, orderContext));

            // maker
            assert.equal(await call(collateral.methods.balanceOf(u1)), initalBalance.minus(makerMargin).minus(makerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u1)), 0);
            assert.equal(await call(long.methods.balanceOf(u1)), toSell.toFixed());

            // taker
            assert.equal(await call(collateral.methods.balanceOf(u2)), makerMargin.minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee));
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);

        });

        it('should sell short positon token to maker', async () => {

            const initalBalance = new BigNumber(toWei(1200));
            await send(admin, collateral.methods.mint(u1, initalBalance.toFixed()));
            await send(u1, collateral.methods.approve(exchange._address, infinity));

            const toSell = new BigNumber(toBase(0.9));
            await send(admin, short.methods.mint(u2, toSell.toFixed()));
            await send(u2, short.methods.approve(exchange._address, infinity));

            await send(relayer, collateral.methods.approve(exchange._address, infinity));

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
                marketContractAddress: mpx._address,
                relayer: relayer,
            };
            const orderContext = {
                marketContract: mpx._address,
                marketCollateralPool: mpx._address,
                collateral: collateral._address,
                positions: [
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
            assert.equal(await call(collateral.methods.balanceOf(u2)), makerMargin.minus(takerFee).minus(gasFee).toFixed());
            assert.equal(await call(short.methods.balanceOf(u2)), 0);
            assert.equal(await call(long.methods.balanceOf(u2)), 0);

            // relayer
            assert.equal(await call(collateral.methods.balanceOf(relayer)), makerFee.plus(takerFee).plus(gasFee).plus(gasFee));
            assert.equal(await call(short.methods.balanceOf(relayer)), 0);
            assert.equal(await call(long.methods.balanceOf(relayer)), 0);

            // exchange
            assert.equal(await call(collateral.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(short.methods.balanceOf(exchange._address)), 0);
            assert.equal(await call(long.methods.balanceOf(exchange._address)), 0);
        });
    });
});
