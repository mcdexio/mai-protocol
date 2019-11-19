const Web3 = require('web3');
const TestToken = artifacts.require('./helper/TestToken.sol');
const MintingPool = artifacts.require('./MintingPool.sol');
const Proxy = artifacts.require('Proxy.sol');
const BigNumber = require('bignumber.js');
const IMarketContract = artifacts.require('interfaces/IMarketContract.sol');

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

const newContract = async (contract, ...args) => {
    const c = await contract.new(...args);
    const w = getWeb3();
    const instance = new w.eth.Contract(contract.abi, c.address);
    return instance;
};

let maketContracts = [
    '0x2967424E7128D459a22ba13D34bB966f547BdBE8'
];
let proxyAddress = '0xF98ef0358E278Bcb042a531A173793ACf2cdaF82';
let marketTokenAddress = '0x5C0286beF1434b07202a5Ae3De38e66130d5280d';
let MintingPoolAddress = null;

module.exports = async () => {
    const web3 = new Web3(provider);
    try {
        if (!marketTokenAddress) {
            const mkt = await newContract(TestToken, 'Market Token', 'Hot', 18);
            marketTokenAddress = mkt._address;
        }
        console.log('Market Token deployed at', web3.utils.toChecksumAddress(marketTokenAddress));

        if (!MintingPoolAddress) {
            const pool = await newContract(MintingPool);
            MintingPoolAddress = pool._address;
        }
        console.log('MintingPool deployed at', web3.utils.toChecksumAddress(MintingPoolAddress));

        if (proxyAddress) {
            const pool = await MintingPool.at(MintingPoolAddress);
            await pool.addAddress(proxyAddress);
            console.log('MintingPool add Proxy(', proxyAddress, ') into whitelist');
        }


        const proxy = await Proxy.at(proxyAddress);

        await proxy.setCollateralPoolAddress(MintingPoolAddress);
        console.log('MintingPool has been applied for Proxy');

        if (maketContracts.length > 0) {
            const pool = await MintingPool.at(MintingPoolAddress);
            await pool.addAddress(proxyAddress);
            for (let i = 0; i < maketContracts.length; i++) {
                await pool.approveCollateralPool(maketContracts[i], infinity);
                console.log('MintingPool approved market contract(', maketContracts[i], ')');
                await proxy.approveCollateralPool(maketContracts[i], MintingPoolAddress, infinity);
                console.log('Proxy approved market contract pool (', MintingPoolAddress, ')');
            }
        }

        process.exit(0);
    } catch (e) {
        console.log(e);
    }
};
