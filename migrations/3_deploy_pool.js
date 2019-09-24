const TestToken = artifacts.require("helper/TestToken.sol");
const MintingPool = artifacts.require("MintingPool.sol");

module.exports = async function(deployer, network, accounts) {
    // test token
    await deployer.deploy(TestToken, "Test Market Token", "MKT", 18);

    // pool
    await deployer.deploy(MintingPool, TestToken.address);
}