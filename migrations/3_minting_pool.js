const MintingPool = artifacts.require('./MintingPool.sol');

module.exports = async function (deployer, network, accounts) {
    await deployer.deploy(MintingPool);
    console.log('  「 deploy minting pool 」--------------------------------------')
    console.log('   > MinintPool:  ', MintingPool.address)
    console.log('   -------------------------------------------------------------')
}
