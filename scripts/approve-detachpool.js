const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IMarketCollateralPool = artifacts.require('./interfaces/IMarketCollateralPool.sol');
const IERC20 = artifacts.require('./IERC20.sol');
const MaiProtocol = artifacts.require('MaiProtocol.sol');

const assert = require('assert');
const addresses = require('./addresses');
const { infinity } = require('./settings');
const { log } = require('./utils');

async function parseMarketContract(marketContractAddress) {
    const marketContract = await IMarketContract.at(marketContractAddress);
    const collateralPool = await IMarketCollateralPool.at(await marketContract.COLLATERAL_POOL_ADDRESS());

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

module.exports = async () => {
    try {
        const maiProtocol = await MaiProtocol.at(addresses.maiProtocol);
        await maiProtocol.setMintingPool("0x0000000000000000000000000000000000000000");
        log("current minting pool =", maiProtocol.mintingPool());

        process.exit(0);
    } catch (error) {
        console.log(error);
        process.exit(1);
    }

}
