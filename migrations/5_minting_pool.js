const Proxy = artifacts.require("Proxy.sol");
const MintingPool = artifacts.require('./MintingPool.sol');

module.exports = async function (deployer, network, accounts) {
    const proxy = await Proxy.deployed();
    console.log("Proxy deployed at", proxy.address);
   
    const pool = await deployer.deploy(MintingPool);
    console.log("MinintPool deployed at", pool.address);

    await pool.addAddress(proxy.address);
    console.log('MintingPool add Proxy(', proxy.address, ') into whitelist');

    await proxy.setCollateralPoolAddress(pool.address);
    console.log('MintingPool has been applied for Proxy');

    console.log('DO NOT FORGET TO call proxy.approveCollateralPool(marketContract, mintingPool, infinity)')
    console.log('DO NOT FORGET TO call pool.approveCollateralPool(marketContract, infinity)')
}
