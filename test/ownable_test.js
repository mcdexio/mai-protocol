const assert = require('assert');
const { getContracts } = require('./utils');

contract('Ownable', accounts => {
    let exchange;

    before(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
    });

    it('should return true when caller is owner', async () => {
        const isOwner = await exchange.methods.isOwner().call({ from: accounts[0] });
        assert.equal(true, isOwner);
    });

    it('should return owner', async () => {
        let owner = await exchange.methods.owner().call({ from: accounts[0] });
        assert.equal(accounts[0].toLowerCase(), owner.toLowerCase());

        // Should also return the owner properly when called by a non owner account
        owner = await exchange.methods.owner().call({ from: accounts[2] });
        assert.equal(accounts[0].toLowerCase(), owner.toLowerCase());
    });

    it("should return false when caller isn't owner", async () => {
        const isOwner = await exchange.methods.isOwner().call({ from: accounts[2] });
        assert.equal(false, isOwner);
    });

    it('should transfer ownership', async () => {
        const exchange = (await getContracts()).exchange;

        await exchange.methods.transferOwnership(accounts[3]).send({ from: accounts[0] });
        let isOwner = await exchange.methods.isOwner().call({ from: accounts[3] });
        assert.equal(true, isOwner);

        // Old owner will no longer be considered the owner
        isOwner = await exchange.methods.isOwner().call({ from: accounts[0] });
        assert.equal(false, isOwner);
    });

    it("can't transfer ownership to empty address", async () => {
        const exchange = (await getContracts()).exchange;

        try {
            await exchange.methods
                .transferOwnership('0x0000000000000000000000000000000000000000')
                .send({ from: accounts[0] });
        } catch (e) {
            assert.ok(e.message.match(/revert/));
            return;
        }

        assert(false, 'Should never get here');
    });

    it("can't transfer ownership if not owner", async () => {
        const exchange = (await getContracts()).exchange;

        try {
            await exchange.methods.transferOwnership(accounts[3]).send({ from: accounts[3] });
        } catch (e) {
            assert.ok(e.message.match(/revert/));
            return;
        }

        assert(false, 'Should never get here');
    });

    it('should have no owner after renouncing', async () => {
        const exchange = (await getContracts()).exchange;

        await exchange.methods.renounceOwnership().send({ from: accounts[0] });
        const owner = await exchange.methods.owner().call({ from: accounts[0] });
        assert.equal('0x0000000000000000000000000000000000000000', owner);
    });

    it('should revert when trying to renounce but not owner', async () => {
        const exchange = (await getContracts()).exchange;

        try {
            await exchange.methods.renounceOwnership().send({ from: accounts[1] });
        } catch (e) {
            assert.ok(e.message.match(/revert/));
            return;
        }

        assert(false, 'Should never get here');
    });
});
