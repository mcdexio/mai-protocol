const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContracts } = require('./utils');
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

contract('Pool', async accounts => {
    let mpx, collateral, long, short, mkt, pool;

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
        mkt = mpxContracs.mkt;
        pool = mpxContracs.pool;
    });

    it('sender not in white list', async () => {
        const err = await pool.methods.mintPositionTokens(
            mpx._address,
            toBase(1),
            false
        ).send({ from: u1, gasLimit: 8000000 }).catch(err => {
            return err;
        })
        assert.equal(err.message.includes("SENDER_NOT_IN_WHITELIST_ERROR"), true);
    });

    it('mint using collateral', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });

        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }

        await collateral.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: u1 });

        await pool.methods.mintPositionTokens(mpx._address, toBase(1), false)
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000, -24));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
        }
    });

    it('mint using mtk', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });

        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }

        await collateral.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: u1 });
        await mkt.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await mkt.methods.approve(pool._address, infinity).send({ from: u1 });
        await mkt.methods.transfer(pool._address, toWei(10000)).send({ from: admin });

        await pool.methods.mintPositionTokens(mpx._address, toBase(1), true)
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000));
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), toWei(10000, -12));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
        }
    });

    it('mint using mtk but no enough mkt', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });

        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }

        await collateral.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: u1 });
        await mkt.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await mkt.methods.approve(pool._address, infinity).send({ from: u1 });

        await pool.methods.mintPositionTokens(mpx._address, toBase(1), true)
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000, -24));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
        }
    });

    it('mint with enough poisition token in pool', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });

        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }

        await collateral.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: u1 });
        await mkt.methods.transfer(u1, toWei(10000)).send({ from: admin });
        await mkt.methods.approve(pool._address, infinity).send({ from: u1 });

        await mkt.methods.transfer(pool._address, toWei(10000)).send({ from: admin });
        await long.methods.transfer(pool._address, toBase(10000)).send({ from: admin });
        await short.methods.transfer(pool._address, toBase(10000)).send({ from: admin });

        await pool.methods.mintPositionTokens(mpx._address, toBase(1), true)
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), toWei(10000));
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(10000, -1));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(10000, -1));
        }
    });

    it('redeem', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });
        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }
        await long.methods.transfer(u1, toBase(1)).send({ from: admin });
        await long.methods.approve(pool._address, infinity).send({ from: u1 });
        await short.methods.transfer(u1, toBase(1)).send({ from: admin });
        await short.methods.approve(pool._address, infinity).send({ from: u1 });

        await pool.methods.redeemPositionTokens(mpx._address, toBase(1))
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(1000));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(0));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(0));
        }
    });

    it('redeem with enough collateral token in pool', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveMarketContractPool(mpx._address).send({ from: admin });
        
        await long.methods.transfer(u1, toBase(1)).send({ from: admin });
        await long.methods.approve(pool._address, infinity).send({ from: u1 });
        await short.methods.transfer(u1, toBase(1)).send({ from: admin });
        await short.methods.approve(pool._address, infinity).send({ from: u1 });
        await collateral.methods.transfer(pool._address, toWei(10000)).send({ from: admin });
  
        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), 0);
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), toWei(10000));
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }
        await pool.methods.redeemPositionTokens(mpx._address, toBase(1))
            .send({ 
                from: u1,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(1000));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(0));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(0));
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), toWei(10000, -1000));
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(1));
        }
    });
});