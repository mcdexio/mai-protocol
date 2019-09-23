const assert = require('assert');
const TestToken = artifacts.require('./helper/TestToken.sol');
const { newContract, getContracts, getMarketContract } = require('./utils');
const BigNumber = require('bignumber.js');

const weis = new BigNumber('1000000000000000000');

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

contract('Proxy', accounts => {
    let proxy;

    before(async () => {
        const contracts = await getContracts();
        proxy = contracts.proxy;

        const mpxContract = await getMarketContract({
            cap: 8500e10,
            floor: 7500e10,
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContract.mpx;
        ctk = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;

        // add creator into whitelist
        await proxy.methods.addAddress(accounts[1]).send({ from: accounts[0] });
    });

    it('should withdraw collateral', async () => {
        const owner = accounts[0];

        await ctk.methods.transfer(proxy._address, toWei(10)).send({ from: owner });

        const balance = new BigNumber(await ctk.methods.balanceOf(owner).call());
        const toWithdraw = new BigNumber(toWei(9));
        // transfer from
        await proxy.methods
            .withdrawCollateral(mpx._address, toWithdraw.toFixed())
            .send({ from: owner });

        assert.equal(balance.plus(toWithdraw).toFixed(), await ctk.methods.balanceOf(owner).call());
    });

    it('should fail to withdraw collateral', async () => {
        const owner = accounts[0];

        await ctk.methods.transfer(proxy._address, toWei(10)).send({ from: owner });

        const balance = new BigNumber(await ctk.methods.balanceOf(owner).call());
        const toWithdraw = new BigNumber(toWei(10.1));
        // transfer from
        await proxy.methods
            .withdrawCollateral(mpx._address, toWithdraw.toFixed())
            .send({ from: owner });

        assert.equal(balance.plus(toWithdraw).toFixed(), await ctk.methods.balanceOf(owner).call());
    });

    it('should transfer 10000 token a to b', async () => {
        const testToken = await newContract(TestToken, 'TestToken', 'TT', 18, { from: accounts[1] });

        // give accounts 2 some tokens
        await testToken.methods.transfer(accounts[2], '30000').send({ from: accounts[1] });
        assert.equal('30000', await testToken.methods.balanceOf(accounts[2]).call());

        // accounts 2 approve
        await testToken.methods.approve(proxy._address, '10000').send({ from: accounts[2] });
        assert.equal('10000', await testToken.methods.allowance(accounts[2], proxy._address).call());

        // transfer from
        await proxy.methods
            .transferFrom(testToken._address, accounts[2], accounts[3], '10000')
            .send({ from: accounts[1] });

        assert.equal('20000', await testToken.methods.balanceOf(accounts[2]).call());
        assert.equal('10000', await testToken.methods.balanceOf(accounts[3]).call());
    });

    it('revert when transferring token the account does not have', async () => {
        const testToken = await newContract(TestToken, 'TestToken', 'TT', 18, { from: accounts[1] });

        // give accounts 2 some tokens
        await testToken.methods.transfer(accounts[2], '30000').send({ from: accounts[1] });
        assert.equal('30000', await testToken.methods.balanceOf(accounts[2]).call());

        // accounts 2 approve more than owned
        await testToken.methods.approve(proxy._address, '100000').send({ from: accounts[2] });
        assert.equal('100000', await testToken.methods.allowance(accounts[2], proxy._address).call());

        // transfer more than account owns
        try {
            await proxy.methods
                .transferFrom(testToken._address, accounts[2], accounts[3], '40000')
                .send({ from: accounts[1] });
        } catch (e) {
            return;
        }

        assert(false, 'Should not get here');
    });
});
