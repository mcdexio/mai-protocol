const assert = require('assert');
const { getContracts } = require('./utils');
const { generateOrderData, getOrderHash } = require('../sdk/sdk');
contract('CancelOrder', accounts => {
    let exchange;

    before(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
    });

    it('should cancel order', async () => {
        const order = {
            trader: accounts[0],
            relayer: '0x0000000000000000000000000000000000000000',
            marketContract: '0x0000000000000000000000000000000000000000',
            amount: 1,
            price: 1,
            data: generateOrderData(1, true, false, 0, 1, 1, 0, 1),
            gasAmount: 0
        };

        const hash = getOrderHash(order);
        let cancelled = await exchange.methods.cancelled(hash).call();
        assert.equal(false, cancelled);

        await exchange.methods.cancelOrder(order).send({ from: order.trader });
        cancelled = await exchange.methods.cancelled(hash).call();
        assert.equal(true, cancelled);
    });

    it("should abort when another try to cancel other's order", async () => {
        const order = {
            trader: accounts[0],
            relayer: '0x0000000000000000000000000000000000000000',
            marketContract: '0x0000000000000000000000000000000000000000',
            amount: 1,
            price: 1,
            data: generateOrderData(1, true, false, 0, 1, 1, 0, 1123123),
            gasAmount: 0
        };

        const hash = getOrderHash(order);
        let cancelled = await exchange.methods.cancelled(hash).call();
        assert.equal(false, cancelled);

        try {
            await exchange.methods.cancelOrder(order).send({ from: accounts[1] });
        } catch (e) {
            assert.ok(e.message.match(/revert/));
            return;
        }

        assert(false, 'Should never get here');
    });
});
