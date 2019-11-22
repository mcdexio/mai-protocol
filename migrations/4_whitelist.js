const Proxy = artifacts.require("Proxy.sol");
const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function (deployer, network, accounts) {
    // proxy
    const proxy = await Proxy.deployed();
    console.log("Proxy deployed at", proxy.address);

    // MaiProtocol
    const mai = await MaiProtocol.deployed();
    console.log('MaiProtocol deployed at:', mai.address);

    // add white list
    await proxy.addAddress(mai.address);
    console.log('add white list success')
};
