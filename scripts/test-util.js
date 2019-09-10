exports.ethServer = 'http://127.0.0.1:8545';
exports.contractOwner = '0x6766f3cfd606e1e428747d3364bae65b6f914d56'; // do not modify when using gananche-cli
exports.relayAddress = '0x93388b4efe13b9b18ed480783c05462409851547'; // do not modify when using gananche-cli

exports.daiAddress = '0x7514FeE073700396EaC37C2cfB6481b59D21B806';
exports.proxyContractAddress = '0x1cb1eC2164f2A6a87261e5b2bD411c2E45762330';
exports.market1 = '0xe641521E90509D03f0d284Cabe34fBdFe6DF1e3c';

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

