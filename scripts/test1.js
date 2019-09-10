#!/usr/local/bin/node

console.log('test1: approve market contract');

const Web3 = require('web3');
const testUtil = require('./test-util');

var provider = new Web3.providers.HttpProvider(testUtil.ethServer);
var web3 = new Web3(provider);

async function gogogo() {
    await testUtil.approveMarketContractPool(web3, testUtil.market1);
    await testUtil.approve(web3, testUtil.daiAddress, testUtil.relayAddress, testUtil.proxyContractAddress, '999999999999999999999999999999999999999999');
}

gogogo().then();
