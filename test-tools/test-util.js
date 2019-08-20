exports.ethServer = 'http://127.0.0.1:8545';
exports.proxyContractAddress = '0x7c27f30a7f51932cdcf7ac8593eeb7571141f220';
exports.approveMarketContractPoolAbi = {"constant": false,"inputs": [{"name": "contractAddress","type": "address"}],"name": "approveMarketContractPool","outputs": [],"payable": false,"stateMutability": "nonpayable","type": "function"};
exports.proxyOwner = '0x6766F3CFD606E1E428747D3364baE65B6f914D56';
exports.market1 = '0x4a37c836290A985935c2e38165Afe4ADb1EC2a02';

exports.approveMarketContractPool = async function(web3, marketContractAddress) {
  var proxy = new web3.eth.Contract(
    [exports.approveMarketContractPoolAbi],
    exports.proxyContractAddress
  );
  proxy.methods.approveMarketContractPool(marketContractAddress)
    .send({ from: exports.proxyOwner })
    .on('transactionHash', hash => {
      console.log('transactionHash', hash);
    })
    .on('confirmation', (confirmationNumber, receipt) => {
      console.log('confirmation', confirmationNumber);
    })
    .on('receipt', receipt => {
      console.log('receipt', receipt);
    })
    .on('error', err => {
      console.log('err', err);
    });
};

