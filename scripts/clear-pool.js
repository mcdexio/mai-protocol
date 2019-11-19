const Web3 = require('web3');
const TestToken = artifacts.require('./helper/TestToken.sol');
const MintingPool = artifacts.require('./MintingPool.sol');
const Proxy = artifacts.require('Proxy.sol');
const BigNumber = require('bignumber.js');
const IMarketContract = artifacts.require('interfaces/IMarketContract.sol');

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

let proxyAddress = '0x60490D6626cf8c8A87DF2913A3E5B31727018551';

module.exports = async () => {
    const web3 = new Web3(provider);
    try {
        const proxy = await Proxy.at(proxyAddress);

        await proxy.setCollateralPoolAddress('0x0000000000000000000000000000000000000000');
        console.log('MintingPool has been applied for Proxy');

        process.exit(0);
    } catch (e) {
        console.log(e);
    }
};
