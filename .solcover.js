module.exports = {
    port: 8555,
    // norpc: true,
    skipFiles: [
        'helper/TestMath.sol',
        'helper/TestOrder.sol',
        'helper/TestSignature.sol',
        'helper/TestToken.sol',
        'helper/WethToken.sol',
        'helper/TestMaiProtocol.sol',
        'helper/TestMarketContract.sol'
    ],
    copyPackages: [
        '@openzeppelin/contracts'
    ]
};
