const MarketContract = artifacts.require('../interfaces/IMarketContract.sol');
const MarketPoolContract = artifacts.require('../interfaces/IMarketContractPool.sol');
const ERC20 = artifacts.require('./interfaces/ERC20.sol');
const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const { newContract, getWeb3, setHotAmount, getContracts, clone } = require('./utils');

const weis = new BigNumber('1000000000000000000');

const toWei = x => {
    return new BigNumber(x).times(weis).toString();
};

const fromWei = x => {
    return new BigNumber(x).div(weis).toString();
};

const infinity = '999999999999999999999999999999999999999999';

contract('Match', async accounts => {
    const relayer = accounts[9];

    const contractPoolAddress = "0xF8e2029d7A714B256Cf3c65Db97B85e123c4021c";
    const contractAddress = "0x3A92C58C7152B3b2d5F56E8d47Ce87d668b47B47";
    const collateralAddress = "0xfbEb7F04Ee0864a4820a73d9c07Bd3E659242979";
    const longTokenAddress = "0xBbF1b53C4d00e7fb3e8479b08717ad4d3D444d7c";
    const shortTokenAddress = "0x7FA99D9E658d2DB6d11632a69c48ad3265E17c8f";

    const admin = accounts[0];
    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    const getContract = async (contract, address) => {
        const w = getWeb3();
        const instance = new w.eth.Contract(contract.abi, address);
        return instance;
    };

    it('market mint', async () => {
        const marketContract = await getContract(MarketContract, contractAddress);
        const marketPoolContract = await getContract(MarketPoolContract, contractPoolAddress);
        const collateralToken = await getContract(ERC20, collateralAddress);
        console.log("Collateral", await collateralToken.methods.balanceOf(admin).call());

        console.log("approve");
        await collateralToken.methods.approve(contractAddress, infinity).send({ from: admin });
        await collateralToken.methods.approve(contractPoolAddress, infinity).send({ from: admin });
        console.log("mintPositionTokens");
        await marketPoolContract.methods.mintPositionTokens(contractAddress, 1, false).send({ from: admin, gas: 8000000 });

        const longToken = await getContract(ERC20, longTokenAddress);
        const shortToken = await getContract(ERC20, shortTokenAddress);
        console.log("Long", await longToken.methods.balanceOf(admin).call());
        console.log("Long", await shortToken.methods.balanceOf(admin).call());
    })

});
