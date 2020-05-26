const MintingPool = artifacts.require('./MintingPool.sol');
const IMarketContract = artifacts.require('./interfaces/IMarketContract.sol');
const IMarketCollateralPool = artifacts.require('./interfaces/IMarketCollateralPool.sol');
const IERC20 = artifacts.require('./IERC20.sol');
const MaiProtocol = artifacts.require('MaiProtocol.sol');

const addresses = require('./addresses');
const { log } = require('./utils');
const Web3 = require("web3");

async function parseMarketContract (marketContractAddress) {
    const marketContract = await IMarketContract.at(marketContractAddress);
    const collateralPool = await IMarketCollateralPool.at(await marketContract.COLLATERAL_POOL_ADDRESS());

    const collateral = await IERC20.at(await marketContract.COLLATERAL_TOKEN_ADDRESS());
    const long = await IERC20.at(await marketContract.LONG_POSITION_TOKEN());
    const short = await IERC20.at(await marketContract.SHORT_POSITION_TOKEN());
    const mkt = await IERC20.at(await collateralPool.mktToken());

    return {
        marketContract,
        collateralPool,
        collateral,
        long,
        short,
        mkt,
    }
}

const getWeb3 = (address) => {
    const provider = new Web3.providers.HttpProvider(address);
    const myWeb3 = new Web3(provider);
    return myWeb3;
};

const newContract = async (contract, ...args) => {
    const c = await contract.new(...args);
    const w = getWeb3("http://s1.jy.mcarlo.com:8545");
    const instance = new w.eth.Contract(contract.abi, c.address);
    return instance;
};

module.exports = async () => {
    try {
        const maiProtocol = await newContract(MaiProtocol);
        log("Mai protocol deployed at", maiProtocol._address);

        const mintingPool = await MintingPool.at(addresses.mintingPool);
        await mintingPool.addAddress(maiProtocol._address);
        log("new MaiProtocol", maiProtocol._address, "added to proxy whitelist");

        log("!! approve relayer to enable trading with new MaiProtocol");

        process.exit(0);
    } catch (e) {
        console.log(e);
    }
};
