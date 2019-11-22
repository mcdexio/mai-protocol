const Proxy = artifacts.require("Proxy.sol");
const MintingPool = artifacts.require('./MintingPool.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(MintingPool);
    console.log("MinintPool deployed at", MintingPool.address);
}
