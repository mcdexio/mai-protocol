const Web3 = require('web3');
const BigNumber = require('bignumber.js');


const Mai = artifacts.require('MaiProtocol.sol');
const Proxy = artifacts.require('Proxy.sol');

// settings
const infinity = '999999999999999999999999999999999999999999';
const ethereumHttpNode = "http://s1.jy.mcarlo.com:8545";
const gasLimit = 8000000;

BigNumber.config({ EXPONENTIAL_AT: 1000 });

const provider = new Web3.providers.HttpProvider(ethereumHttpNode);

const getWeb3 = () => {
    const myWeb3 = new Web3(provider);
    return myWeb3;
};

const newContract = async (contract, ...args) => {
    const c = await contract.new(...args);
    const w = getWeb3();
    const instance = new w.eth.Contract(contract.abi, c.address);
    return instance;
};

module.exports = async () => {
    const proxyAddress = '0x60490D6626cf8c8A87DF2913A3E5B31727018551';
    try {
        console.log("Proxy deployed at", proxyAddress);

        const mai = await newContract(Mai, proxyAddress);
        console.log("Mai protocol deployed at", mai._address);

        const proxy = await Proxy.at(proxyAddress);
        await proxy.addAddress(mai._address);
        console.log("Mai added to proxy whitelist");

        process.exit(0);
    } catch (e) {
        console.log(e);
    }
};
