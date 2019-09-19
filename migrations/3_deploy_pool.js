const TestToken = artifacts.require("helper/TestToken.sol");
const MintingPool = artifacts.require("MintingPool.sol");

module.exports = async function(deployer, network, accounts) {
    return deployer.deploy(TestToken, "Market Token", "MKT", 18).then(function() {
        return deployer.deploy(MintingPool, TestToken.address);
    });
}