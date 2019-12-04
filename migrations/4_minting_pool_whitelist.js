const MaiProtocol = artifacts.require("MaiProtocol.sol");
const MintingPool = artifacts.require('./MintingPool.sol');

module.exports = async function (deployer, network, accounts) {

  const mai = await MaiProtocol.deployed();
  const pool = await MintingPool.deployed();

  pool.addAddress(mai.address).then(() => {
    console.log('   > MaiProtocol(', mai.address, ') has been added into whitelist of MintingPool');
  });

  mai.setMintingPool(pool.address).then(() => {
    console.log('   > MintingPool(', pool.address, ') has been applied for MaiProtocol');
  });

  console.log('  「 sumary 」--------------------------------------------------')
  console.log('   > MaiProtocol:  ', MaiProtocol.address)
  console.log('   > MintingPool:  ', MintingPool.address)
  console.log('   > ')
  console.log('   > !!! DO NOT FORGET:')
  console.log('   >     - mai.approve(marketContract.COLLATERAL_TOKEN_ADDRESS(), infinity)')
  console.log('   >     - mai.approve(marketContract.LONG_POSITION_TOKEN(), infinity)')
  console.log('   >     - mai.approve(marketContract.SHORT_POSITION_TOKEN, infinity)')
  console.log('   >     - pool.approveCollateralPool(marketContract, infinity)')
  console.log('   > !!! TO ENABLE MPX')
  console.log('   -------------------------------------------------------------')
}
