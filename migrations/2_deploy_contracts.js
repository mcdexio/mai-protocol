const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function (deployer, network, accounts) {
    // MaiProtocol
    await deployer.deploy(MaiProtocol);

    console.log('  「 deploy mai protocol 」--------------------------------------')
    console.log('   > MaiProtocol:  ', MaiProtocol.address)
    console.log('   -------------------------------------------------------------')
};
