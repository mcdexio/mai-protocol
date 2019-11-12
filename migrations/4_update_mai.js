const Proxy = artifacts.require("Proxy.sol");
const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function (deployer, network, accounts) {
    const old_mai = MaiProtocol.address;

    const proxy = await Proxy.deployed();
    console.log("Proxy deployed at", proxy.address);
   
    const mai = await deployer.deploy(MaiProtocol, proxy.address);
    console.log("Mai protocol deployed at", mai.address);

    await proxy.addAddress(mai.address);
    console.log("Mai added to proxy whitelist");

    await proxy.removeAddress(old_mai);
    console.log("Old Mai", old_mai, "has been removed from proxy whitelist")
}
