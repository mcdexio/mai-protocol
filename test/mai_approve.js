const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContract, buildOrder } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

contract('Mai', async accounts => {
    let exchange, proxy;
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
        mkt = mpxContract.mkt;
        pool = mpxContract.pool;
    });

    it('proxy approve multi-times', async () => {
        let tokens = [collateral, long, short, mkt];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(proxy._address, mpx._address).call();
            assert.equal(allowance, "0")
        }
        await proxy.methods.approveCollateralPool(mpx._address, mpx._address, infinity)
            .send({ from: admin, gasLimit: 8000000 });

        tokens = [collateral, long, short];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(proxy._address, mpx._address).call();
            assert.equal(allowance, infinity)
        }

        // consume some allowance
        await collateral.methods.transfer(proxy._address, toWei(10000))
            .send({ from: admin, gasLimit: 8000000 });
        await proxy.methods.addAddress(admin)
            .send({ from: admin, gasLimit: 8000000 });
        await proxy.methods.mintPositionTokens(mpx._address, toBase(1))
            .send({ from: admin, gasLimit: 8000000 });

        const allowanceRemain = (new BigNumber(infinity)).minus(toWei(1024))
        tokens = [collateral];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(proxy._address, mpx._address).call();
            assert.equal(allowance, allowanceRemain.toFixed());
        }

        await proxy.methods.approveCollateralPool(mpx._address, mpx._address, infinity)
            .send({ from: admin, gasLimit: 8000000 });

        tokens = [collateral];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(proxy._address, mpx._address).call();
            assert.equal(allowance, allowanceRemain.toFixed());
        }

        // to 0
        await proxy.methods.approveCollateralPool(mpx._address, mpx._address, "0")
            .send({ from: admin, gasLimit: 8000000 });

        tokens = [collateral, long, short];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(proxy._address, mpx._address).call();
            assert.equal(allowance, "0")
        }
    })

    it('pool approve multi-times', async () => {
        let tokens = [collateral, mkt];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(pool._address, mpx._address).call();
            assert.equal(allowance, "0")
        }
        await pool.methods.approveCollateralPool(mpx._address, infinity)
            .send({ from: admin, gasLimit: 8000000 });

        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(pool._address, mpx._address).call();
            assert.equal(allowance, infinity)
        }

        // consume some allowance
        await collateral.methods.transfer(pool._address, toWei(10000))
            .send({ from: admin, gasLimit: 8000000 });
        await collateral.methods.approve(pool._address, infinity)
            .send({ from: admin, gasLimit: 8000000 });
        await pool.methods.addAddress(admin)
            .send({ from: admin, gasLimit: 8000000 });
        await pool.methods.mintPositionTokens(mpx._address, toBase(1), false)
            .send({ from: admin, gasLimit: 8000000 });

        const allowanceRemain = (new BigNumber(infinity)).minus(toWei(1024))
        tokens = [collateral];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(pool._address, mpx._address).call();
            assert.equal(allowance, allowanceRemain.toFixed());
        }

        await pool.methods.approveCollateralPool(mpx._address, infinity)
            .send({ from: admin, gasLimit: 8000000 });

        tokens = [collateral];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(pool._address, mpx._address).call();
            assert.equal(allowance, allowanceRemain.toFixed());
        }

        // to 0
        await pool.methods.approveCollateralPool(mpx._address, "0")
            .send({ from: admin, gasLimit: 8000000 });

        tokens = [collateral, mkt];
        for (let i = 0; i < tokens.length; i++) {
            const allowance = await tokens[i].methods.allowance(pool._address, mpx._address).call();
            assert.equal(allowance, "0")
        }

    })
});
