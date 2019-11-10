const contractAddresses = require('./contract-addresses.js');

const Proxy = artifacts.require('Proxy.sol');
const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IERC20 = artifacts.require('./IERC20.sol');

const infinity = '999999999999999999999999999999999999999999';

module.exports = async () => {
    try {
        const mpContract = await IMarketContract.at(contractAddresses.marketContract);
        const mpPoolAddress = await mpContract.COLLATERAL_POOL_ADDRESS();
        console.log("Collateral pool", mpPoolAddress);

        console.log("Approving [ Proxy -> CollatralPool ] ...");
        const proxy = await Proxy.at(contractAddresses.proxy);
        await proxy.approveCollateralPool(contractAddresses.marketContract, mpPoolAddress, infinity);
        console.log("Approved  [", contractAddresses.proxy, "->", mpPoolAddress, "]");

        console.log("Approving [ Relayer -> Proxy ] ...");
        const collateral = await IERC20.at(contractAddresses.collateral);
        await collateral.approve(contractAddresses.proxy, infinity, { from: contractAddresses.relayerAccount });
        console.log("Approved  [", contractAddresses.relayerAccount, "->", contractAddresses.proxy, "]");

        const allowance = await collateral.allowance(contractAddresses.relayerAccount, contractAddresses.proxy);
        console.log("Current relayer", contractAddresses.relayerAccount, "allowance is", allowance.toString());

        process.exit(0);
    } catch (error) {
        console.log(error);
        process.exit(1);
    }

}
