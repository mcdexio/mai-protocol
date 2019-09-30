const assert = require('assert');
const { getWeb3, getContracts, getMarketContract, buildOrder } = require('./utils');
const TestMarketContract = artifacts.require('helper/TestMarketContract.sol');
const CollateralToken = artifacts.require('helper/TestToken.sol');
const LongPositionToken = artifacts.require('helper/TestToken.sol');
const ShortPositionToken = artifacts.require('helper/TestToken.sol');
const BigNumber = require('bignumber.js');
const { toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

contract('MPX', accounts => {
    let mpx;
    let collateral, short, long;

    const admin = accounts[0];
    const u1 = accounts[1];
    const u2 = accounts[1];

    const transferFrom = async (token, from, to, value) => {
        await token.methods.transfer(to, value).send({ from: from });
        return value;
    }

    const approve = async (token, from, to) => {
        await token.methods.approve(to, infinity).send({from:  from});
    }

    const balanceOf = async (token, user) => {
        return await token.methods.balanceOf(user).call();
    } 

    beforeEach(async () => {
        const contracts = await getMarketContract({
            cap: 8500e10,
            floor: 7500e10,
            multiplier: 1000,
            feeRate: 250,  // 25 / 10000
        })
        collateral = contracts.collateral;
        long = contracts.long;
        short = contracts.short;
        mpx = contracts.mpx;
    }); 

    it('check parameters', async () => {

        assert.equal(await mpx.methods.CONTRACT_NAME().call(), "mock");
        assert.equal(await mpx.methods.PRICE_CAP().call(), 8500e10);
        assert.equal(await mpx.methods.PRICE_FLOOR().call(), 7500e10);
        assert.equal(await mpx.methods.QTY_MULTIPLIER().call(), 1000);
        assert.equal(await mpx.methods.COLLATERAL_PER_UNIT().call(), 1000e13);
        assert.equal(await mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT().call(), 20e13);

        assert.equal(await mpx.methods.COLLATERAL_TOKEN_ADDRESS().call(), collateral._address);
        assert.equal(await mpx.methods.LONG_POSITION_TOKEN().call(), long._address);
        assert.equal(await mpx.methods.SHORT_POSITION_TOKEN().call(), short._address);

        assert.equal(await mpx.methods.COLLATERAL_POOL_ADDRESS().call(), mpx._address);
        
    });

    it('mint', async () => {
        const initialBalance = new BigNumber(toWei(10000));

        await transferFrom(collateral, admin, u1, initialBalance.toFixed());
        await approve(collateral, u1, mpx._address);

        assert.equal(await balanceOf(long, u1), toBase(0));
        assert.equal(await balanceOf(short, u1), toBase(0));

        const amountToMint = new BigNumber(toBase(1));
        await mpx.methods.mintPositionTokens(mpx._address, amountToMint.toFixed(), false).send({from: u1, gas: 8000000 });

        const collateralPerUnit = new BigNumber(await mpx.methods.COLLATERAL_PER_UNIT().call());
        const collateralTokenFeePerUnit = new BigNumber(await mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT().call());
        const mintCost = collateralPerUnit.plus(collateralTokenFeePerUnit).times(amountToMint);

        assert.equal(await balanceOf(collateral, u1), initialBalance.minus(mintCost).toFixed());
        assert.equal(await balanceOf(long, u1), toBase(1));
        assert.equal(await balanceOf(short, u1), toBase(1));
        
    });

    it('mint2', async () => {
        const initialBalance = new BigNumber(toWei(10000));

        await transferFrom(collateral, admin, u1, initialBalance.toFixed());
        await approve(collateral, u1, mpx._address);

        assert.equal(await balanceOf(long, u1), toBase(0));
        assert.equal(await balanceOf(short, u1), toBase(0));

        const amountToMint = new BigNumber(toBase(0.1));
        await mpx.methods.mintPositionTokens(mpx._address, amountToMint.toFixed(), false).send({from: u1, gas: 8000000 });

        const collateralPerUnit = new BigNumber(await mpx.methods.COLLATERAL_PER_UNIT().call());
        const collateralTokenFeePerUnit = new BigNumber(await mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT().call());
        const mintCost = collateralPerUnit.plus(collateralTokenFeePerUnit).times(amountToMint);
        
        assert.equal(await balanceOf(collateral, u1), initialBalance.minus(mintCost).toFixed());
        assert.equal(await balanceOf(long, u1), toBase(0.1));
        assert.equal(await balanceOf(short, u1), toBase(0.1));
        
    });

    it('redeem', async () => {
        await short.methods.mint(u1, toBase(1)).send({from: admin});
        await long.methods.mint(u1, toBase(1)).send({from: admin});
        await approve(short, u1, mpx._address);
        await approve(long, u1, mpx._address);
        
        const amountToRedeem = new BigNumber(toBase(1));
        await mpx.methods.redeemPositionTokens(mpx._address, toBase(1)).send({from: u1, gas: 8000000 });
        const collateralPerUnit = new BigNumber(await mpx.methods.COLLATERAL_PER_UNIT().call());
        const collateralTokenFeePerUnit = new BigNumber(await mpx.methods.COLLATERAL_TOKEN_FEE_PER_UNIT().call());
        const redeemGain = collateralPerUnit.times(amountToRedeem);

        assert.equal(await balanceOf(long, u1), toBase(0));
        assert.equal(await balanceOf(short, u1), toBase(0));
        assert.equal(await balanceOf(collateral, u1), redeemGain.toFixed());
    });
});