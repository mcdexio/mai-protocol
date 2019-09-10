exports.ethServer = 'http://127.0.0.1:8545';
exports.contractOwner = '0x6766f3cfd606e1e428747d3364bae65b6f914d56'; // do not modify when using gananche-cli
exports.relayAddress = '0x93388b4efe13b9b18ed480783c05462409851547'; // do not modify when using gananche-cli

exports.daiAddress = '0x7514FeE073700396EaC37C2cfB6481b59D21B806';
exports.proxyContractAddress = '0x7c27F30a7f51932cdCf7Ac8593EEb7571141F220';
exports.market1 = '0x4a37c836290A985935c2e38165Afe4ADb1EC2a02';

exports.approveMarketContractPoolAbi = {"constant": false,"inputs": [{"name": "contractAddress","type": "address"}],"name": "approveMarketContractPool","outputs": [],"payable": false,"stateMutability": "nonpayable","type": "function"};
exports.approveMarketContractPool = async function(web3, marketContract) {
  var proxy = new web3.eth.Contract(
    [exports.approveMarketContractPoolAbi],
    exports.proxyContractAddress
  );
  proxy.methods.approveMarketContractPool(marketContract)
    .send({ from: exports.contractOwner })
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

exports.IERC20AllowanceAbi = {"constant": true,"inputs": [{"name": "owner","type": "address"},{"name": "spender","type": "address"}],"name": "allowance","outputs": [{"name": "","type": "uint256"}],"payable": false,"stateMutability": "view","type": "function"};
exports.allowance = async function(web3, erc20, owner, spender) {
  var proxy = new web3.eth.Contract(
    [exports.IERC20AllowanceAbi],
    erc20
  );
  return await proxy.methods.allowance(owner, spender).call();
};

exports.IERC20Approve = {"constant": false,"inputs": [{"name": "_spender","type": "address"},{"name": "_value","type": "uint256"}],"name": "approve","outputs": [{"name": "success","type": "bool"}],"payable": false,"stateMutability": "nonpayable","type": "function"}
exports.approve = async function(web3, erc20, owner, spender, value) {
  var proxy = new web3.eth.Contract(
    [exports.IERC20Approve],
    erc20
  );
  return await proxy.methods.approve(spender, value)
    .send({ from: owner })
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

