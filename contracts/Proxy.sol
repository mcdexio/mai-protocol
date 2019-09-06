/*

    Copyright 2018 The Hydro Protocol Foundation

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/LibOwnable.sol";
import "./lib/LibWhitelist.sol";
import "./interfaces/IMarketContractPool.sol";
import "./interfaces/IMarketContract.sol";
import "./interfaces/IERC20.sol";

contract Proxy is LibOwnable, LibWhitelist {
    using SafeMath for uint256;

    address public minterAddress;

    // uint256 public constant INFINITY = 2**256 - 1;
    uint256 public constant INFINITY = 999999999999999999999999999999999999999999;
    mapping( address => uint256 ) public balances;

    event Deposit(address owner, uint256 amount);
    event Withdraw(address owner, uint256 amount);
    event WithdrawFee(address owner, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function depositEther() public payable {
        balances[msg.sender] = balances[msg.sender].add(msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdrawEther(uint256 amount) public {
        balances[msg.sender] = balances[msg.sender].sub(amount);
        msg.sender.transfer(amount);
        emit Withdraw(msg.sender, amount);
    }

    function () public payable {
        depositEther();
    }

    /// @param _minterAddress Address of minter.
    function setMinterAddress(address _minterAddress) public onlyOwner {
        minterAddress = _minterAddress;
    }

    /// Approve transfer from proxy for mint or redeem. This method must be called immediately
    /// after every trading pair added to dex system.
    /// @param contractAddress Address of market contract.
    function approveMarketContractPool(address contractAddress) public onlyOwner {
        IMarketContract marketContract = IMarketContract(contractAddress);

        IERC20 collateralToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        if (minterAddress != 0) {
            collateralToken.approve(minterAddress, INFINITY);
        } else {
            collateralToken.approve(marketContract.COLLATERAL_POOL_ADDRESS(), INFINITY);
        }
    }

    function withdrawMarketCollateralFee(address contractAddress, uint256 amount)
        public
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(contractAddress);

        IERC20 collateralToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        collateralToken.transfer(msg.sender, amount);

        emit WithdrawFee(msg.sender, amount);
    }

    /// @dev Invoking transferFrom.
    /// @param token Address of token to transfer.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transfer(address token, address to, uint256 value)
        external
        onlyAddressInWhitelist
    {
        if (token == address(0)) {
            transferEther(address(this), to, value);
        } else {
            transferToken(token, to, value);
        }
    }

    /// @dev Invoking transferFrom.
    /// @param token Address of token to transfer.
    /// @param from Address to transfer token from.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transferFrom(address token, address from, address to, uint256 value)
        external
        onlyAddressInWhitelist
    {
        if (token == address(0)) {
            transferEther(from, to, value);
        } else {
            transferTokenFrom(token, from, to, value);
        }
    }

    function transferEther(address from, address to, uint256 value)
        internal
        onlyAddressInWhitelist
    {
        balances[from] = balances[from].sub(value);
        balances[to] = balances[to].add(value);

        emit Transfer(from, to, value);
    }

    function mintPositionTokens(
        address contractAddress,
        uint256 qtyToMint
    )
        external
        onlyAddressInWhitelist
    {
        IMarketContractPool marketContractPool;
        if (minterAddress != 0) {
            marketContractPool = IMarketContractPool(minterAddress);
        } else {
            IMarketContract marketContract = IMarketContract(contractAddress);
            marketContractPool = IMarketContractPool(marketContract.COLLATERAL_POOL_ADDRESS());
        }
        marketContractPool.mintPositionTokens(contractAddress, qtyToMint, false);
    }

    function redeemPositionTokens(
        address contractAddress,
        uint256 qtyToMint
    )
        external
        onlyAddressInWhitelist
    {
        IMarketContractPool marketContractPool;
        if (minterAddress != 0) {
            marketContractPool = IMarketContractPool(minterAddress);
        } else {
            IMarketContract marketContract = IMarketContract(contractAddress);
            marketContractPool = IMarketContractPool(marketContract.COLLATERAL_POOL_ADDRESS());
        }
        marketContractPool.redeemPositionTokens(contractAddress, qtyToMint);
    }

/// @dev Calls into ERC20 Token contract, invoking transferFrom.
    /// @param token Address of token to transfer.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transferToken(address token, address to, uint256 value)
        internal
        onlyAddressInWhitelist
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // keccak256('transfer(address,uint256)') & 0xFFFFFFFF00000000000000000000000000000000000000000000000000000000
            mstore(0, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            // calldatacopy(t, f, s) copy s bytes from calldata at position f to mem at position t
            // copy from, to, value from calldata to memory
            calldatacopy(4, 36, 64)
            // call ERC20 Token contract transferFrom function
            let result := call(gas, token, 0, 0, 68, 0, 32)

            // Some ERC20 Token contract doesn't return any value when calling the transferFrom function successfully.
            // So we consider the transferFrom call is successful in either case below.
            //   1. call successfully and nothing return.
            //   2. call successfully, return value is 32 bytes long and the value isn't equal to zero.
            switch eq(result, 1)
            case 1 {
                switch or(eq(returndatasize, 0), and(eq(returndatasize, 32), gt(mload(0), 0)))
                case 1 {
                    return(0, 0)
                }
            }
        }

        revert("TOKEN_TRANSFER_ERROR");
    }

    /// @dev Calls into ERC20 Token contract, invoking transferFrom.
    /// @param token Address of token to transfer.
    /// @param from Address to transfer token from.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transferTokenFrom(address token, address from, address to, uint256 value)
        internal
        onlyAddressInWhitelist
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // keccak256('transferFrom(address,address,uint256)') & 0xFFFFFFFF00000000000000000000000000000000000000000000000000000000
            mstore(0, 0x23b872dd00000000000000000000000000000000000000000000000000000000)

            // calldatacopy(t, f, s) copy s bytes from calldata at position f to mem at position t
            // copy from, to, value from calldata to memory
            calldatacopy(4, 36, 96)

            // call ERC20 Token contract transferFrom function
            let result := call(gas, token, 0, 0, 100, 0, 32)

            // Some ERC20 Token contract doesn't return any value when calling the transferFrom function successfully.
            // So we consider the transferFrom call is successful in either case below.
            //   1. call successfully and nothing return.
            //   2. call successfully, return value is 32 bytes long and the value isn't equal to zero.
            switch eq(result, 1)
            case 1 {
                switch or(eq(returndatasize, 0), and(eq(returndatasize, 32), gt(mload(0), 0)))
                case 1 {
                    return(0, 0)
                }
            }
        }

        revert("TOKEN_TRANSFER_FROM_ERROR");
    }
}