const MintingPool = artifacts.require('./MintingPool.sol');
const Proxy = artifacts.require('Proxy.sol');
const BigNumber = require('bignumber.js');
const IMarketContract = artifacts.require('interfaces/IMarketContract.sol');

BigNumber.config({ EXPONENTIAL_AT: 1000 });
const infinity = '999999999999999999999999999999999999999999';
const settings = {
    mintingPoolAddress: '0x2ff32DD952136D9Fd6a5dc4d553861b81907f618',
    maketContracts: [
        '0xBc82350A3ca9d18454d8910fcF1a962Ad334C057'
    ],
    proxyAddress: '0xbCB3ee6D9509Ec15939497658e18567088A11990'
}

module.exports = async () => {
    try {
	const proxy = await Proxy.at(settings.proxyAddress);
	const pool = await MintingPool.at(settings.mintingPoolAddress)

        for (let i = 0; i < settings.maketContracts.length; i++) {
            const mpxAddress = settings.maketContracts[i];
            await pool.approveCollateralPool(mpxAddress, infinity);
            console.log('MintingPool approved market contract(', mpxAddress, ')');
            await proxy.approveCollateralPool(mpxAddress, pool.address, infinity);
            console.log('Proxy approved market contract pool (', mpxAddress, ')');
        }
	console.log("All done");
        process.exit(0);
    } catch (e) {
        console.log(e);
        process.exit(0);
    }
};
