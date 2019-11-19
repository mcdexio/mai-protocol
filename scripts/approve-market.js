const Proxy = artifacts.require('Proxy.sol');
const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IERC20 = artifacts.require('./IERC20.sol');

const infinity = '999999999999999999999999999999999999999999';

const contractAddresses = {
  marketContract: '0x2967424E7128D459a22ba13D34bB966f547BdBE8',
  collateral: '0xe48719a5555e7e2be9Ef85c61fD07b3267271BCC',
  proxy: '0x01a0D4E74Ac48BF574F5aB89680F5E55d3Fb058C',
  
  // do not modify the following addresses if you are using our ganache-cli
  relayerAccount: "0x93388b4efe13b9b18ed480783c05462409851547",
}


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
