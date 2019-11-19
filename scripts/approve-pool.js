const MintingPool = artifacts.require('./MintingPool.sol');
const Proxy = artifacts.require('Proxy.sol');
const BigNumber = require('bignumber.js');
const IMarketContract = artifacts.require('interfaces/IMarketContract.sol');

BigNumber.config({ EXPONENTIAL_AT: 1000 });
const infinity = '999999999999999999999999999999999999999999';
const settings = {
    mintingPoolAddress: '0x1AA25040Dbf401B3FDF67DceC5Bb2Fe2E531A55b',
    maketContracts: [
        '0x2967424E7128D459a22ba13D34bB966f547BdBE8',
    ],
    proxyAddress: '0x01a0D4E74Ac48BF574F5aB89680F5E55d3Fb058C'
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
