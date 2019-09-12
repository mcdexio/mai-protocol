const Web3 = require('web3');

exports.ethServer = 'http://127.0.0.1:8545';
exports.contractOwner = '0x6766f3cfd606e1e428747d3364bae65b6f914d56'; // do not modify when using gananche-cli
exports.relayAddress = '0x93388b4efe13b9b18ed480783c05462409851547'; // do not modify when using gananche-cli

exports.daiAddress = '0x31e67D461D79835C271fd11aEC73336a3a6DD6d7';
exports.proxyAddress = '0x7c27F30a7f51932cdCf7Ac8593EEb7571141F220';
exports.market1 = '0x4a37c836290A985935c2e38165Afe4ADb1EC2a02';

const provider = new Web3.providers.HttpProvider(exports.ethServer);

exports.getWeb3 = () => {
    const myWeb3 = new Web3(provider);
    return myWeb3;
};