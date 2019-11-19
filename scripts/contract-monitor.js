const Web3 = require('web3');
const BigNumber = require('bignumber.js');


const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IMarketContractPool = artifacts.require('./interfaces/IMarketContractPool.sol');
const Proxy = artifacts.require('Proxy.sol');

// settings
const infinity = '999999999999999999999999999999999999999999';
const ethereumHttpNode = "http://10.30.204.89:8545";
const gasLimit = 8000000;

BigNumber.config({ EXPONENTIAL_AT: 1000 });

const provider = new Web3.providers.HttpProvider(ethereumHttpNode);

const getWeb3 = () => {
    const myWeb3 = new Web3(provider);
    return myWeb3;
};

const marketContractAddress = "0x2967424E7128D459a22ba13D34bB966f547BdBE8";
const proxyAddress = '0x60490D6626cf8c8A87DF2913A3E5B31727018551';

module.exports = async () => {
    const web3 = new Web3(provider);
    try {
        const mpContract = await IMarketContract.at(marketContractAddress);
        const mpPoolAddress = await mpContract.COLLATERAL_POOL_ADDRESS();
        console.log("Market Collateral Pool deployed at", mpPoolAddress);

        const mpPool = await IMarketContractPool.at(mpPoolAddress);
        const mktAddress = await mpPool.mktToken();
        console.log("Market Token deployed at", mktAddress);

        const proxy = await Proxy.at(proxyAddress);
        const minterAddress = await proxy.minterAddress();
        console.log("Current active minter is", minterAddress);


        process.exit(0);
    } catch (e) {
        console.log(e);
    }
};
