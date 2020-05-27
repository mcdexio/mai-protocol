const assert = require('assert');
const { newContract } = require('./utils');
const TestMath = artifacts.require('./helper/TestMath.sol');

contract('Math', accounts => {
    let math;

    before(async () => {
        math = await newContract(TestMath);
    });

    it('isRoundingError', async () => {
        let res = await math.methods.isRoundingErrorPublic(100, 4, 3).call();
        assert.equal(false, res);

        res = await math.methods.isRoundingErrorPublic(100, 333, 10).call();
        assert.equal(true, res);

        res = await math.methods.isRoundingErrorPublic(100, 3, 10).call();
        assert.equal(true, res);

        res = await math.methods.isRoundingErrorPublic(100, 1999, 20).call();
        assert.equal(false, res);
    });

    it('getPartialAmount', async () => {
        let res = await math.methods.getPartialAmountFloorPublic(100, 4, 3).call();
        assert.equal(75, res);

        try {
            await math.methods.getPartialAmountFloorPublic(100, 333, 10).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.match(/revert/));
        }

        try {
            await math.methods.getPartialAmountFloorPublic(100, 3, 10).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.match(/revert/));
        }

        res = await math.methods.getPartialAmountFloorPublic(100, 1999, 20).call();
        assert.equal(1, res);
    });

    it('getPartialAmount 2', async () => {

        let res = await math.methods.getPartialAmountFloorPublic(1, 100, 100).call();
        assert.equal(1, res);

        res = await math.methods.getPartialAmountFloorPublic(1, 1999, 2000).call();
        assert.equal(1, res);

        try {
            res = await math.methods.getPartialAmountFloorPublic(1, 1998, 2000).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.includes("ROUNDING_ERROR"));
        }
        try {
            let res = await math.methods.getPartialAmountFloorPublic(4, 3, 100).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.includes("ROUNDING_ERROR"));
        }

        try {
            await math.methods.getPartialAmountFloorPublic(10, 3, 100).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.includes("ROUNDING_ERROR"));
        }

        try {
            res = await math.methods.getPartialAmountFloorPublic(100, 333, 1000).call();
            throw null;
        } catch (e) {
            assert.ok(e.message.includes("ROUNDING_ERROR"));
        }
    });

    it('min', async () => {
        let res = await math.methods.minPublic(100, 99).call();
        assert.equal(99, res);

        res = await math.methods.minPublic(0, 1).call();
        assert.equal(0, res);
    });
});
