const MintingPool = artifacts.require('./MintingPool.sol');
const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IMarketContractPool = artifacts.require('./interfaces/IMarketContractPool.sol');
const IERC20 = artifacts.require('./IERC20.sol');
const MaiProtocol = artifacts.require('MaiProtocol.sol');

const assert = require('assert');
const addresses = require('./addresses');
const { infinity } = require('./settings');
const { log } = require('./utils');

async function parseMarketContract(marketContractAddress) {
    const marketContract = await IMarketContract.at(marketContractAddress);
    const collateralPool = await IMarketContractPool.at(await marketContract.COLLATERAL_POOL_ADDRESS());

    const collateral = await IERC20.at(await marketContract.COLLATERAL_TOKEN_ADDRESS());
    const long = await IERC20.at(await marketContract.LONG_POSITION_TOKEN());
    const short = await IERC20.at(await marketContract.SHORT_POSITION_TOKEN());
    const mkt = await IERC20.at(await collateralPool.mktToken());

    return {
        marketContract,
        collateralPool,
        collateral,
        long,
        short,
        mkt,
    }
}

async function tryApproveERC20(owner, token, spender, amount) {
    if (await token.allowance(owner.address, spender) == 0) {
        await owner.approveERC20(token.address, spender, amount);
        assert.equal(await token.allowance(owner.address, spender), amount, "unexpected allowance of collateral");
    }
    const allowance = await token.allowance(owner.address, spender);
    log(token.address, "for", spender, "=", allowance.toString());
    assert.ok(allowance > 0);
}

module.exports = async () => {
    try {
        const maiProtocol = await MaiProtocol.at(addresses.maiProtocol);
        const mintingPool = await MintingPool.at(addresses.mintingPool);

        for (let i = 0; i < addresses.marketContracts.length; i++) {
            const mpContractAddress = addresses.marketContracts[i];
            log("approving tokens for", mpContractAddress);

            const { collateral, long, short, mkt, collateralPool } = await parseMarketContract(mpContractAddress);

            await tryApproveERC20(maiProtocol, collateral, mintingPool.address, infinity);
            await tryApproveERC20(maiProtocol, long, mintingPool.address, infinity);
            await tryApproveERC20(maiProtocol, short, mintingPool.address, infinity);

            await tryApproveERC20(mintingPool, collateral, collateralPool.address, infinity);
            await tryApproveERC20(mintingPool, mkt, collateralPool.address, infinity);

            log(mpContractAddress, "approved");
        }

        process.exit(0);
    } catch (error) {
        console.log(error);
        process.exit(1);
    }
};
