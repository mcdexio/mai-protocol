const util = require('./util.js');
const contractAddresses = require('./contract-addresses.js');

const Proxy = artifacts.require('Proxy.sol');
const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IERC20 = artifacts.require('./interfaces/IERC20.sol');

const infinity = '999999999999999999999999999999999999999999';

// ==== begin of settings ======
const relayerAccount = "0x93388b4efe13b9b18ed480783c05462409851547";

// ==== end of settings ======


module.exports = async () => {
    try {
        const mpContract = await IMarketContract.at(contractAddresses.marketContract);
        const mpPoolAddress = await mpContract.COLLATERAL_POOL_ADDRESS();
        console.log("Collateral pool", mpPoolAddress);

        console.log("Approving [ Proxy -> CollatralPool ] ...");
        const proxy = await Proxy.at(contractAddresses.proxy);
        await proxy.approveCollateralPool(contractAddresses.marketContract, mpPoolAddress, infinity);
        console.log("Approved  [", contractAddresses.proxy, "->", mpPoolAddress, "]");

        console.log("Approving [ Replayer -> Proxy ] ...");
        const collateral = await IERC20.at(contractAddresses.collateral);
        await collateral.approve(contractAddresses.proxy, infinity, { from: relayerAccount });
        console.log("Approved  [", relayerAccount, "->", contractAddresses.proxy, "]");

        const allowance = await collateral.allowance(relayerAccount, contractAddresses.proxy);
        console.log("Current relayer", relayerAccount, "allowance is", allowance.toString());

    } catch (error) {
        console.log(error);
    }

}
