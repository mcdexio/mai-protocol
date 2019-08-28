const Web3 = require('web3');
const Proxy = artifacts.require('./Proxy.sol');
const HybridExchange = artifacts.require('./HybridExchange.sol');
const BigNumber = require('bignumber.js');
const TestToken = artifacts.require('helper/TestToken.sol');
const TestMarketContract = artifacts.require('helper/TestMarketContract.sol');
const ExchangePool = artifacts.require('./ExchangePool.sol');

BigNumber.config({ EXPONENTIAL_AT: 1000 });

const getWeb3 = () => {
    const myWeb3 = new Web3(web3.currentProvider);
    return myWeb3;
};

const newContract = async (contract, ...args) => {
    const c = await contract.new(...args);
    const w = getWeb3();
    const instance = new w.eth.Contract(contract.abi, c.address);
    return instance;
};

const newContractAt = (contract, address) => {
    const w = getWeb3();
    const instance = new w.eth.Contract(contract.abi, address);
    return instance;
};

const setHotAmount = async (hotContract, user, amount) => {
    const balance = await hotContract.methods.balanceOf(user).call();

    const diff = new BigNumber(amount).minus(balance);

    if (diff.gt(0)) {
        await hotContract.methods.transfer(user, diff.toString()).send({ from: web3.eth.accounts[0] });
    } else if (diff.lt(0)) {
        await hotContract.methods.transfer(web3.eth.accounts[0], diff.abs().toString()).send({ from: user });
    }
};

const getContracts = async () => {
    const proxy = await newContract(Proxy);
    // console.log('Proxy address', web3.toChecksumAddress(proxy._address));

    const exchange = await newContract(HybridExchange, proxy._address);

    // console.log('Dxchange address', web3.toChecksumAddress(exchange._address));
    const accounts = await web3.eth.getAccounts();

    await proxy.methods.addAddress(exchange._address).send({ from: accounts[0] });

    return {
        proxy,
        exchange
    };
};

const getMarketContracts = async (configs) => {
    const collateral = await newContract(TestToken, "Collateral Token", "CTK", 18);
    const long = await newContract(TestToken, "Long Position Token", "lBTC", 5);
    const short = await newContract(TestToken, "Short Position Token", "sBTC", 5);
    const mkt = await newContract(TestToken, "Market Token", "MTK", 18);
    const mpx = await newContract(
        TestMarketContract,
        collateral._address,
        long._address,
        short._address,
        mkt._address,
        configs.cap,
        configs.floor,
        configs.multiplier,
        configs.feeRate
    );
    
    const pool = await newContract(ExchangePool, mkt._address);
    
    const accounts = await web3.eth.getAccounts();

    await Promise.all([
        collateral.methods.setWhitelist(mpx._address, true).send({ from: accounts[0] }),
        long.methods.setWhitelist(mpx._address, true).send({ from: accounts[0] }),
        short.methods.setWhitelist(mpx._address, true).send({ from: accounts[0] }),
    ]);

    return {
        collateral,
        long,
        short,
        mpx,
        mkt,
        pool,
    }
}

const clone = x => JSON.parse(JSON.stringify(x));

module.exports = {
    getWeb3,
    newContract,
    newContractAt,
    getContracts,
    clone,
    setHotAmount,
    getMarketContracts
};
