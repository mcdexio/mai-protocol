const Web3 = require('web3');
const MaiProtocol = artifacts.require('./MaiProtocol.sol');
const TestMaiProtocol = artifacts.require('helper/TestMaiProtocol.sol');
const TestToken = artifacts.require('helper/TestToken.sol');
const TestMarketContract = artifacts.require('helper/TestMarketContract.sol');
const MintingPool = artifacts.require('./MintingPool.sol');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { fromRpcSig } = require('ethereumjs-util');
const assert = require('assert');

const BigNumber = require('bignumber.js');
BigNumber.config({ EXPONENTIAL_AT: 1000 });

const prices = new BigNumber('10000000000');
const bases = new BigNumber('100000');
const weis = new BigNumber('1000000000000000000');

const toPrice = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(prices));
    }
    return sum.toFixed();
}

const fromPrice = x => {
    return new BigNumber(x).div(prices).toString();
}

const toBase = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(bases));
    }
    return sum.toFixed();
}

const fromBase = x => {
    return new BigNumber(x).div(bases).toString();
}

const toWei = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(weis));
    }
    return sum.toFixed();
};

const fromWei = x => {
    return new BigNumber(x).div(weis).toString();
};

const infinity = '999999999999999999999999999999999999999999';

const shouldFailOnError = async (message, func) => {
    try {
        await func();
    } catch (error) {
        assert.ok(
            error.message.includes(message),
            `exception should include "${message}", but get "${error.message}"`);
        return;
    }
    assert.fail(`should fail with "${message}"`);
}

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

const getContracts = async () => {
    const exchange = await newContract(MaiProtocol);
    // console.log('[test]MaiProtocol deployed at', exchange._address);
    return {
        exchange
    };
};

const getTestContracts = async () => {
    const exchange = await newContract(TestMaiProtocol);
    // console.log('[test]TestMaiProtocol deployed at', exchange._address);
    return {
        exchange
    };
};

const getMarketContract = async (configs) => {
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
    // console.log('[test]TestMarketContract deployed at', mpx._address)

    const pool = await newContract(MintingPool, mkt._address);
    // console.log('[test]MintingPool deployed at', pool._address)

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

const getOrderSignature = async (order) => {
    const orderHash = getOrderHash(order);
    const newWeb3 = getWeb3();

    // This depends on the client, ganache-cli/testrpc auto prefix the message header to message
    // So we have to set the method ID to 0 even through we use web3.eth.sign
    const signature = fromRpcSig(await newWeb3.eth.sign(orderHash, order.trader));
    signature.config = `0x${signature.v.toString(16)}00` + '0'.repeat(60);
    const isValid = isValidSignature(order.trader, signature, orderHash);

    assert.equal(true, isValid);
    order.signature = signature;
    order.orderHash = orderHash;
};

const buildOrder = async (orderParam) => {
    const order = {
        trader: orderParam.trader,
        relayer: orderParam.relayer,
        marketContractAddress: orderParam.marketContractAddress,
        amount: orderParam.amount,
        price: orderParam.price,
        gasTokenAmount: orderParam.gasTokenAmount,
        data: generateOrderData(
            orderParam.version,
            orderParam.side === 'sell',
            orderParam.type === 'market',
            orderParam.expiredAtSeconds,
            orderParam.asMakerFeeRate,
            orderParam.asTakerFeeRate,
            orderParam.makerRebateRate || '0',
            orderParam.salt || 10000000,
            false,
        ),
    };

    await getOrderSignature(order);

    return order;
};

function increaseEvmTime(duration) {
    const id = Date.now();
    return new Promise((resolve, reject) => {
        web3.currentProvider.send({
            jsonrpc: '2.0',
            method: 'evm_increaseTime',
            params: [duration],
            id: id,
        }, (err, resp) => {
            if (err) {
                reject(err);
                return;
            }
            web3.currentProvider.send({
                jsonrpc: '2.0',
                method: 'evm_mine',
                params: [],
                id: id + 1,
            }, (err, resp) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
}

module.exports = {
    getWeb3,
    newContract,
    newContractAt,
    getContracts,
    getTestContracts,
    clone,
    getMarketContract,
    getOrderSignature,
    buildOrder,
    increaseEvmTime,
    toPrice, fromPrice, toBase, fromBase, toWei, fromWei, infinity,
    shouldFailOnError
};
