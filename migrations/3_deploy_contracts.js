const Proxy = artifacts.require("Proxy.sol");
const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function (deployer, network, accounts) {
    // proxy
    const proxy = await Proxy.deployed();
    console.log("Proxy deployed at", proxy.address);

    // MaiProtocol
    await deployer.deploy(MaiProtocol, proxy.address);

    console.log('   ------------------------------------------------------------')
    console.log('   > MaiProtocol:  ', MaiProtocol.address)
    console.log('   -------------------------------------------------------------')
};
