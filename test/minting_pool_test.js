const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getContracts, getMarketContract } = require('./utils');
const { toBase, fromBase, toWei, fromWei, infinity } = require('./utils');

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

        const mpxContracs = await getMarketContract({
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
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });

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
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });

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
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000, -24));
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), toWei(10000, -12));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
        }
    });

    it('mint using mtk but no enough mkt', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });

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
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });

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
            assert.equal(await collateral.methods.balanceOf(u1).call(), toWei(10000, -1000, -24));
            assert.equal(await long.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(u1).call(), toBase(1));
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), toWei(10000));
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(10000, -1));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(10000, -1));
        }
    });

    it('redeem', async () => {
        await pool.methods.addAddress(u1).send({ from: admin });
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });
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
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });

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

    it('convert pos -> ctk', async () => {
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });
        {
            assert.equal(await long.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await short.methods.balanceOf(pool._address).call(), 0);
        }

        await long.methods.transfer(pool._address, toBase(1)).send({ from: admin });
        await long.methods.approve(pool._address, infinity).send({ from: admin });
        await short.methods.transfer(pool._address, toBase(1)).send({ from: admin });
        await short.methods.approve(pool._address, infinity).send({ from: admin });

        await pool.methods.internalRedeemPositionTokens(mpx._address, toBase(1))
            .send({
                from: admin,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), toWei(1000));
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(0));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(0));
        }
    });

    it('convert ctk -> pos', async () => {
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });
        await collateral.methods.transfer(pool._address, toWei(1024)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: admin });
        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), toWei(1024));
        }

        await pool.methods.internalMintPositionTokens(mpx._address, toBase(1), false)
            .send({
                from: admin,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(1));
        }
    });

    it('convert ctk -> pos with mkt', async () => {
        await pool.methods.approveCollateralPool(mpx._address, infinity).send({ from: admin });
        await collateral.methods.transfer(pool._address, toWei(1000)).send({ from: admin });
        await collateral.methods.approve(pool._address, infinity).send({ from: admin });
        await mkt.methods.transfer(pool._address, toWei(12)).send({ from: admin });
        await mkt.methods.approve(pool._address, infinity).send({ from: admin });
        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), toWei(1000));
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), toWei(12));
        }

        await pool.methods.internalMintPositionTokens(mpx._address, toBase(1), true)
            .send({
                from: admin,
                gasLimit: 8000000,
            });

        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), 0);
            assert.equal(await long.methods.balanceOf(pool._address).call(), toBase(1));
            assert.equal(await short.methods.balanceOf(pool._address).call(), toBase(1));
        }
    });

    it('withdraw ctk', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await collateral.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });
        const balanceOfAdmin = new BigNumber(await collateral.methods.balanceOf(admin).call());


        await collateral.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});

        await pool.methods.withdrawCollateral(mpx._address, balanceToWithdraw.toFixed())
            .send({ from: admin, gasLimit: 8000000 });

        {
            assert.equal(await collateral.methods.balanceOf(pool._address).call(), 0);
            assert.equal(
                await collateral.methods.balanceOf(admin).call(),
                balanceOfAdmin.plus(balanceToWithdraw).toFixed()
            );
        }
    });

    it('withdraw mtk', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await mkt.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });
        const balanceOfAdmin = new BigNumber(await mkt.methods.balanceOf(admin).call());


        await mkt.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});

        await pool.methods.withdrawMarketToken(mpx._address, balanceToWithdraw.toFixed())
            .send({ from: admin, gasLimit: 8000000 });

        {
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), 0);
            assert.equal(
                await mkt.methods.balanceOf(admin).call(),
                balanceOfAdmin.plus(balanceToWithdraw).toFixed()
            );
        }
    });

    it('fail to withdraw ctk if not owner', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await collateral.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });

        await collateral.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});
        try {
            await pool.methods.withdrawCollateral(mpx._address, balanceToWithdraw.toFixed())
                .send({ from: u1, gasLimit: 8000000 });
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("NOT_OWNER"), true);
        }
    });

    it('fail to withdraw ctk if not enough funds', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await collateral.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });
        const balanceOfAdmin = new BigNumber(await collateral.methods.balanceOf(admin).call());


        await collateral.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});
        try {
            await pool.methods.withdrawCollateral(mpx._address, balanceToWithdraw.times(1.1).toFixed())
                .send({ from: admin, gasLimit: 8000000 });
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("low-level call failed"), true);
        }
    });

    it('withdraw mkt', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await mkt.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });
        const balanceOfAdmin = new BigNumber(await mkt.methods.balanceOf(admin).call());


        await mkt.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});

        await pool.methods.withdrawMarketToken(mpx._address, balanceToWithdraw.toFixed())
            .send({ from: admin, gasLimit: 8000000 });

        {
            assert.equal(await mkt.methods.balanceOf(pool._address).call(), 0);
            assert.equal(
                await mkt.methods.balanceOf(admin).call(),
                balanceOfAdmin.plus(balanceToWithdraw).toFixed()
            );
        }
    });

    it('fail to withdraw mkt if not owner', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await mkt.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });

        await mkt.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});
        try {
            await pool.methods.withdrawMarketToken(mpx._address, balanceToWithdraw.toFixed())
                .send({ from: u1, gasLimit: 8000000 });
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("NOT_OWNER"), true);
        }
    });

    it('fail to withdraw mkt if not enough funds', async () => {

        const balanceToWithdraw = new BigNumber(toWei(1234.1));
        await mkt.methods.transfer(u1, balanceToWithdraw.toFixed()).send({ from: admin });
        const balanceOfAdmin = new BigNumber(await mkt.methods.balanceOf(admin).call());


        await mkt.methods.transfer(pool._address, balanceToWithdraw.toFixed())
            .send({ from: u1});
        try {
            await pool.methods.withdrawMarketToken(mpx._address, balanceToWithdraw.times(1.1).toFixed())
                .send({ from: admin, gasLimit: 8000000 });
            throw null;
        } catch (error) {
            assert.equal(error.message.includes("low-level call failed"), true);
        }
    });
});